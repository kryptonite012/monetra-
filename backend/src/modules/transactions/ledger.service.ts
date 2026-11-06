import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { db, type Db } from '../../db/knex';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { dec, money, storage } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { requireOpenAccount } from '../accounts/accounts.service';
import { normalizeMerchant, suggestCategory } from '../categories/categorizer';
import { categoryBySlug, resolveCategory, type CategoryKind } from '../categories/categories.service';

export type Direction = 'credit' | 'debit';
export type TxnKind =
  | 'income' | 'expense' | 'transfer' | 'adjustment' | 'refund' | 'fee' | 'interest'
  | 'loan_disbursement' | 'loan_repayment' | 'investment_buy' | 'investment_sell'
  | 'bill_payment' | 'goal_contribution' | 'reversal';

/** Which category kind a ledger entry of each kind may carry. */
const CATEGORY_KIND: Partial<Record<TxnKind, CategoryKind>> = {
  income: 'income',
  refund: 'income',
  interest: 'income',
  expense: 'expense',
  fee: 'expense',
  bill_payment: 'expense',
  loan_repayment: 'expense',
  transfer: 'transfer',
  goal_contribution: 'transfer',
  investment_buy: 'transfer',
  investment_sell: 'transfer',
};

/** Ledger kinds whose direction is fixed. */
const FIXED_DIRECTION: Partial<Record<TxnKind, Direction>> = {
  income: 'credit',
  refund: 'credit',
  interest: 'credit',
  loan_disbursement: 'credit',
  investment_sell: 'credit',
  expense: 'debit',
  fee: 'debit',
  bill_payment: 'debit',
  loan_repayment: 'debit',
  investment_buy: 'debit',
};

export interface PostInput {
  userId: string;
  accountId: string;
  direction?: Direction;
  amount: string;
  kind: TxnKind;
  occurredOn: string;
  description: string;
  categoryId?: string | null;
  merchantId?: string | null;
  merchantName?: string | null;
  paymentMethodId?: string | null;
  notes?: string | null;
  reference?: string | null;
  counterparty?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: 'manual' | 'recurring' | 'import' | 'system';
  transferGroupId?: string | null;
  supersedesId?: string | null;
  allowDuplicate?: boolean;
  autoCategorize?: boolean;
}

export interface PostedTransaction extends Record<string, any> {
  warnings: string[];
}

async function findOrCreateMerchant(userId: string, name: string, conn: Db): Promise<string> {
  const normalized = normalizeMerchant(name) || name.toLowerCase();
  const existing = await conn('merchants').where({ user_id: userId, normalized_name: normalized }).first('id');
  if (existing) return existing.id;
  const [row] = await conn('merchants')
    .insert({ user_id: userId, name: name.trim(), normalized_name: normalized })
    .onConflict(['user_id', 'normalized_name'])
    .merge({ name: name.trim() })
    .returning('id');
  return row.id;
}

/**
 * Posts one ledger entry after validating ownership, account state,
 * category compatibility and duplicates. Must run inside a transaction when
 * combined with other writes.
 */
export async function postTransaction(input: PostInput, conn: Db = db): Promise<PostedTransaction> {
  const warnings: string[] = [];
  const direction = FIXED_DIRECTION[input.kind] ?? input.direction;
  if (!direction) throw unprocessable('direction is required for this kind of entry', { field: 'direction' });
  if (input.direction && FIXED_DIRECTION[input.kind] && input.direction !== FIXED_DIRECTION[input.kind]) {
    throw unprocessable(`A ${input.kind} entry must be a ${FIXED_DIRECTION[input.kind]}`, { field: 'direction' });
  }
  if (!dec(input.amount).gt(0)) throw unprocessable('Amount must be greater than zero', { field: 'amount' });

  // Lock the account row so concurrent postings against it are serialised.
  const account = await requireOpenAccount(input.userId, input.accountId, conn);
  await conn('accounts').where({ id: account.id }).forUpdate().first('id');
  if (input.occurredOn < account.openingDate) {
    warnings.push(`Dated before the account's opening date (${account.openingDate})`);
  }

  let merchantId = input.merchantId ?? null;
  if (merchantId) await requireOwnedRef('merchants', merchantId, input.userId, 'merchantId', conn);
  else if (input.merchantName?.trim()) merchantId = await findOrCreateMerchant(input.userId, input.merchantName, conn);

  if (input.paymentMethodId) {
    const pm = await requireOwnedRef('payment_methods', input.paymentMethodId, input.userId, 'paymentMethodId', conn);
    if (!pm?.isActive) throw unprocessable('Payment method is inactive', { field: 'paymentMethodId' });
  }

  const expectedKind = CATEGORY_KIND[input.kind];
  let categoryId = input.categoryId ?? null;
  const metadata = { ...(input.metadata ?? {}) };
  if (categoryId) {
    await resolveCategory(input.userId, categoryId, expectedKind, conn);
  } else if (expectedKind && input.autoCategorize !== false) {
    const suggestion = await suggestCategory(
      input.userId,
      { description: input.description, merchantId, merchantName: input.merchantName, upiVpa: input.counterparty, kind: expectedKind },
      conn,
    );
    if (suggestion.categoryId) {
      categoryId = suggestion.categoryId;
      metadata.autoCategory = { source: suggestion.source, explanation: suggestion.explanation };
    } else if (expectedKind === 'expense') {
      categoryId = await categoryBySlug('expense.other', conn);
    } else if (expectedKind === 'income') {
      categoryId = await categoryBySlug('income.other', conn);
    }
  }

  if (input.reference && !input.allowDuplicate) {
    const dup = await conn('transactions')
      .where({ account_id: input.accountId, reference: input.reference, status: 'posted' })
      .whereNot({ kind: 'reversal' })
      .first('id');
    if (dup) throw conflict('A transaction with this payment reference already exists on this account', { duplicateOf: dup.id });
  }
  const similar = await conn('transactions')
    .where({ account_id: input.accountId, occurred_on: input.occurredOn, amount: storage(input.amount), direction, status: 'posted' })
    .whereNot({ kind: 'reversal' })
    .first('id');
  if (similar) warnings.push('A transaction with the same amount and date already exists on this account');

  if (direction === 'debit' && account.creditLimit != null) {
    const { rows } = await conn.raw(
      `SELECT a.opening_balance + COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END), 0) AS balance
         FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE a.id = ? GROUP BY a.id`,
      [account.id],
    );
    const after = dec(rows[0].balance).minus(input.amount);
    if (after.abs().gt(account.creditLimit) && after.isNegative()) warnings.push('This takes the account beyond its credit limit');
  }

  const [row] = await conn('transactions')
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      direction,
      amount: storage(input.amount),
      currency: account.currency,
      kind: input.kind,
      category_id: categoryId,
      merchant_id: merchantId,
      payment_method_id: input.paymentMethodId ?? null,
      occurred_on: input.occurredOn,
      description: input.description.trim(),
      notes: input.notes ?? null,
      reference: input.reference ?? null,
      counterparty: input.counterparty ?? null,
      transfer_group_id: input.transferGroupId ?? null,
      supersedes_id: input.supersedesId ?? null,
      source: input.source ?? 'manual',
      tags: input.tags ?? [],
      metadata: JSON.stringify(metadata),
      created_by: input.userId,
    })
    .returning('*');
  return { ...row, warnings };
}

export interface TransferInput {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  occurredOn: string;
  description?: string;
  categoryId?: string | null;
  reference?: string | null;
  notes?: string | null;
  kind?: 'transfer' | 'goal_contribution';
  source?: PostInput['source'];
  supersedesId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Moves money between two of the user's accounts as a balanced pair of entries. */
export async function postTransfer(input: TransferInput, conn: Knex.Transaction) {
  if (input.fromAccountId === input.toAccountId) throw unprocessable('Choose two different accounts');
  const [from, to] = await Promise.all([
    requireOpenAccount(input.userId, input.fromAccountId, conn),
    requireOpenAccount(input.userId, input.toAccountId, conn),
  ]);
  if (from.currency !== to.currency) throw unprocessable('Transfers between different currencies are not supported yet');
  const categoryId =
    input.categoryId ?? (await categoryBySlug(to.type === 'credit_card' ? 'transfer.card_payment' : 'transfer.internal', conn));
  const groupId = randomUUID();
  const description = input.description?.trim() || `Transfer: ${from.name} → ${to.name}`;
  const common = {
    userId: input.userId,
    amount: input.amount,
    kind: input.kind ?? ('transfer' as const),
    occurredOn: input.occurredOn,
    description,
    categoryId,
    notes: input.notes,
    transferGroupId: groupId,
    source: input.source,
    supersedesId: input.supersedesId,
    metadata: input.metadata,
    autoCategorize: false,
  };
  const out = await postTransaction({ ...common, accountId: from.id, direction: 'debit', reference: input.reference, counterparty: to.name }, conn);
  const inn = await postTransaction({ ...common, accountId: to.id, direction: 'credit', counterparty: from.name, allowDuplicate: true }, conn);
  return { transferGroupId: groupId, debit: out, credit: inn, warnings: [...out.warnings, ...inn.warnings] };
}

/**
 * Reverses an entry by posting an equal and opposite entry and marking the
 * original as reversed. Transfers are reversed as a pair.
 */
export async function reverseTransaction(userId: string, transactionId: string, reason: string, conn: Knex.Transaction) {
  const original = await conn('transactions').where({ id: transactionId, user_id: userId }).forUpdate().first();
  if (!original) throw notFound('Transaction');
  if (original.kind === 'reversal') throw unprocessable('A reversal cannot itself be reversed; post a new entry instead');
  if (original.status === 'reversed') throw new AppError(409, 'ALREADY_REVERSED', 'This transaction has already been reversed');

  const legs = original.transferGroupId
    ? await conn('transactions').where({ transfer_group_id: original.transferGroupId, user_id: userId, status: 'posted' }).whereNot({ kind: 'reversal' }).forUpdate()
    : [original];

  for (const leg of legs) await requireOpenAccount(userId, leg.accountId, conn);

  const reversals = [];
  for (const leg of legs) {
    const [rev] = await conn('transactions')
      .insert({
        user_id: userId,
        account_id: leg.accountId,
        direction: leg.direction === 'credit' ? 'debit' : 'credit',
        amount: leg.amount,
        currency: leg.currency,
        kind: 'reversal',
        category_id: leg.categoryId,
        merchant_id: leg.merchantId,
        payment_method_id: leg.paymentMethodId,
        occurred_on: leg.occurredOn,
        description: `Reversal: ${leg.description}`.slice(0, 500),
        notes: reason,
        transfer_group_id: leg.transferGroupId,
        reversal_of_id: leg.id,
        source: 'system',
        metadata: JSON.stringify({ reason }),
        created_by: userId,
      })
      .returning('*');
    await conn('transactions').where({ id: leg.id }).update({ status: 'reversed', reversed_by_id: rev.id });
    reversals.push(rev);
  }
  return reversals;
}

/** Shapes a ledger row for API responses. */
export function serializeTransaction(row: Record<string, any>) {
  const amount = dec(row.amount);
  return {
    ...row,
    amount: money(amount),
    signedAmount: money(row.direction === 'credit' ? amount : amount.neg()),
  };
}
