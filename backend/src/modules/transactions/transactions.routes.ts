import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { notFound, unprocessable } from '../../lib/errors';
import { apiRouter, envelope, idParams, isoDate, optionalText, pageMeta } from '../../lib/http';
import { positiveMoney } from '../../lib/money';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { resolveCategory } from '../categories/categories.service';
import { postTransaction, postTransfer, reverseTransaction, serializeTransaction, type TxnKind } from './ledger.service';
import { listTransactions, transactionFilters } from './transactions.query';

const r = apiRouter('/transactions', 'Transactions');

const tags = z.array(z.string().trim().min(1).max(40)).max(10);
const today = () => new Date().toISOString().slice(0, 10);

const entryBody = z.object({
  accountId: z.uuid(),
  kind: z.enum(['income', 'expense', 'refund', 'fee', 'interest', 'adjustment']),
  direction: z.enum(['credit', 'debit']).optional(),
  amount: positiveMoney,
  occurredOn: isoDate.default(today),
  description: z.string().trim().min(1).max(500),
  categoryId: z.uuid().nullish(),
  merchantId: z.uuid().nullish(),
  merchantName: optionalText(120),
  paymentMethodId: z.uuid().nullish(),
  reference: optionalText(64),
  counterparty: optionalText(200),
  notes: optionalText(2000),
  tags: tags.default([]),
  allowDuplicate: z.boolean().default(false),
});

r.get('/', {
  summary: 'Search and filter the ledger',
  query: transactionFilters,
  handler: async ({ user, query }) => {
    const { rows, total, totals } = await listTransactions(user.id, query);
    return envelope(rows.map(serializeTransaction), { ...pageMeta(query, total), totals });
  },
});

r.post('/', {
  summary: 'Record a ledger entry (income, expense, refund, fee, interest or adjustment)',
  status: 201,
  body: guarded(entryBody),
  handler: async ({ user, body, req }) => {
    if (body.kind === 'adjustment' && !body.direction) throw unprocessable('Adjustments need a direction', { field: 'direction' });
    const txn = await withTransaction((trx) => postTransaction({ ...body, userId: user.id, kind: body.kind as TxnKind }, trx));
    await audit({ action: 'transaction.posted', req, entityType: 'transaction', entityId: txn.id, metadata: { kind: txn.kind, amount: txn.amount } });
    return serializeTransaction(txn);
  },
});

r.post('/transfer', {
  summary: 'Transfer money between your accounts (also used for credit card bill payments)',
  status: 201,
  body: guarded(
    z.object({
      fromAccountId: z.uuid(),
      toAccountId: z.uuid(),
      amount: positiveMoney,
      occurredOn: isoDate.default(today),
      description: optionalText(500),
      categoryId: z.uuid().nullish(),
      reference: optionalText(64),
      notes: optionalText(2000),
    }),
  ),
  handler: async ({ user, body, req }) => {
    if (body.categoryId) await resolveCategory(user.id, body.categoryId, 'transfer');
    const result = await withTransaction((trx) => postTransfer({ ...body, description: body.description ?? undefined, userId: user.id }, trx));
    await audit({ action: 'transaction.transfer', req, entityType: 'transfer', entityId: result.transferGroupId, metadata: { amount: body.amount } });
    return { transferGroupId: result.transferGroupId, debit: serializeTransaction(result.debit), credit: serializeTransaction(result.credit), warnings: result.warnings };
  },
});

r.get('/:id', {
  summary: 'Transaction details with reversal, transfer and correction links',
  params: idParams,
  handler: async ({ user, params }) => {
    const txn = await db('transactions as t')
      .leftJoin('accounts as a', 'a.id', 't.account_id')
      .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
      .leftJoin('merchants as m', 'm.id', 't.merchant_id')
      .leftJoin('payment_methods as p', 'p.id', 't.payment_method_id')
      .where({ 't.id': params.id, 't.user_id': user.id })
      .first('t.*', 'a.name as account_name', 'c.name as category_name', 'm.name as merchant_name', 'p.label as payment_method_label');
    if (!txn) throw notFound('Transaction');
    const related = await db('transactions')
      .where({ user_id: user.id })
      .andWhere((q) => {
        q.where({ reversal_of_id: txn.id }).orWhere({ supersedes_id: txn.id });
        if (txn.reversalOfId) q.orWhere({ id: txn.reversalOfId });
        if (txn.supersedesId) q.orWhere({ id: txn.supersedesId });
        if (txn.transferGroupId) q.orWhere({ transfer_group_id: txn.transferGroupId });
      })
      .whereNot({ id: txn.id })
      .orderBy('posted_at');
    return { ...serializeTransaction(txn), related: related.map(serializeTransaction) };
  },
});

r.patch('/:id', {
  summary: 'Annotate a transaction (category, merchant, description, notes, tags)',
  description: 'Financial fields are immutable. Use /correct to change amount, date or account.',
  params: idParams,
  body: guarded(
    z
      .object({
        categoryId: z.uuid().nullable(),
        merchantId: z.uuid().nullable(),
        description: z.string().trim().min(1).max(500),
        notes: optionalText(2000),
        tags,
      })
      .partial(),
  ),
  handler: async ({ user, params, body, req }) => {
    const txn = await db('transactions').where({ id: params.id, user_id: user.id }).first();
    if (!txn) throw notFound('Transaction');
    if (body.categoryId) {
      const cat = await resolveCategory(user.id, body.categoryId);
      const compatible: Record<string, string[]> = {
        income: ['income'], refund: ['income'], interest: ['income'], expense: ['expense'], fee: ['expense'],
        bill_payment: ['expense'], loan_repayment: ['expense'], transfer: ['transfer'],
      };
      if (compatible[txn.kind] && !compatible[txn.kind].includes(cat!.kind)) throw unprocessable(`Choose a ${compatible[txn.kind][0]} category`);
    }
    if (body.merchantId) {
      const m = await db('merchants').where({ id: body.merchantId, user_id: user.id }).first('id');
      if (!m) throw unprocessable('Merchant not found');
    }
    const patch = Object.fromEntries(
      Object.entries({ category_id: body.categoryId, merchant_id: body.merchantId, description: body.description, notes: body.notes, tags: body.tags }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    const [row] = await db('transactions').where({ id: params.id }).update(patch).returning('*');
    await audit({ action: 'transaction.annotated', req, entityType: 'transaction', entityId: params.id, metadata: { fields: Object.keys(body) } });
    return serializeTransaction(row);
  },
});

r.post('/:id/reverse', {
  summary: 'Reverse a transaction (posts an equal and opposite entry)',
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500) }),
  handler: async ({ user, params, body, req }) => {
    const reversals = await withTransaction((trx) => reverseTransaction(user.id, params.id, body.reason, trx));
    await audit({ action: 'transaction.reversed', req, entityType: 'transaction', entityId: params.id, metadata: { reason: body.reason } });
    return { reversed: params.id, reversals: reversals.map(serializeTransaction) };
  },
});

r.post('/:id/correct', {
  summary: 'Correct a transaction: reverses it and posts a replacement linked to the original',
  params: idParams,
  body: guarded(
    z.object({
      reason: z.string().trim().min(3).max(500),
      amount: positiveMoney.optional(),
      occurredOn: isoDate.optional(),
      accountId: z.uuid().optional(),
      toAccountId: z.uuid().optional(),
      description: z.string().trim().min(1).max(500).optional(),
      categoryId: z.uuid().nullish(),
      paymentMethodId: z.uuid().nullish(),
      reference: optionalText(64),
    }),
  ),
  handler: async ({ user, params, body, req }) => {
    const result = await withTransaction(async (trx) => {
      const original = await trx('transactions').where({ id: params.id, user_id: user.id }).first();
      if (!original) throw notFound('Transaction');
      if (original.kind === 'reversal') throw unprocessable('Reversal entries cannot be corrected');
      if (original.transferGroupId) {
        const legs = await trx('transactions').where({ transfer_group_id: original.transferGroupId }).whereNot({ kind: 'reversal' });
        const debit = legs.find((l) => l.direction === 'debit');
        const credit = legs.find((l) => l.direction === 'credit');
        await reverseTransaction(user.id, original.id, body.reason, trx);
        const transfer = await postTransfer(
          {
            userId: user.id,
            fromAccountId: body.accountId ?? debit.accountId,
            toAccountId: body.toAccountId ?? credit.accountId,
            amount: body.amount ?? original.amount,
            occurredOn: body.occurredOn ?? original.occurredOn,
            description: body.description ?? original.description,
            categoryId: body.categoryId ?? original.categoryId,
            reference: body.reference !== undefined ? body.reference : debit.reference,
            kind: original.kind,
            supersedesId: debit.id,
          },
          trx,
        );
        return { replacement: transfer.debit, warnings: transfer.warnings };
      }
      if (!['income', 'expense', 'refund', 'fee', 'interest', 'adjustment'].includes(original.kind)) {
        throw unprocessable(`Correct ${original.kind.replace('_', ' ')} entries from their own module`);
      }
      await reverseTransaction(user.id, original.id, body.reason, trx);
      const replacement = await postTransaction(
        {
          userId: user.id,
          accountId: body.accountId ?? original.accountId,
          direction: original.direction,
          amount: body.amount ?? original.amount,
          kind: original.kind,
          occurredOn: body.occurredOn ?? original.occurredOn,
          description: body.description ?? original.description,
          categoryId: body.categoryId !== undefined ? body.categoryId : original.categoryId,
          merchantId: original.merchantId,
          paymentMethodId: body.paymentMethodId !== undefined ? body.paymentMethodId : original.paymentMethodId,
          reference: body.reference !== undefined ? body.reference : original.reference,
          counterparty: original.counterparty,
          notes: original.notes,
          tags: original.tags,
          supersedesId: original.id,
          allowDuplicate: true,
          autoCategorize: false,
        },
        trx,
      );
      return { replacement, warnings: replacement.warnings };
    });
    await audit({ action: 'transaction.corrected', req, entityType: 'transaction', entityId: params.id, metadata: { replacement: result.replacement.id, reason: body.reason } });
    return { corrected: params.id, replacement: serializeTransaction(result.replacement), warnings: result.warnings };
  },
});

export default r.router;
