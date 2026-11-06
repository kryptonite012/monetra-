import type { Knex } from 'knex';
import { db, withTransaction } from '../../db/knex';
import { addDays, daysBetween } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { dec, money, percent, storage, sum } from '../../lib/money';
import { postTransaction, reverseTransaction } from '../transactions/ledger.service';

export interface ExpenseInput {
  accountId: string;
  amount: string;
  occurredOn: string;
  description: string;
  categoryId?: string | null;
  merchantId?: string | null;
  merchantName?: string | null;
  paymentMethodId?: string | null;
  reference?: string | null;
  counterparty?: string | null;
  notes?: string | null;
  tags?: string[];
  gstAmount?: string | null;
  isTaxDeductible?: boolean;
  taxSection?: string | null;
  isReimbursable?: boolean;
  recurringRuleId?: string | null;
  source?: 'manual' | 'recurring';
  allowDuplicate?: boolean;
}

async function postExpenseEntry(userId: string, input: ExpenseInput, trx: Knex.Transaction, supersedesId?: string) {
  return postTransaction(
    {
      userId,
      accountId: input.accountId,
      kind: 'expense',
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description,
      categoryId: input.categoryId,
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      paymentMethodId: input.paymentMethodId,
      reference: input.reference,
      counterparty: input.counterparty,
      notes: input.notes,
      tags: input.tags,
      source: input.source ?? 'manual',
      supersedesId,
      allowDuplicate: input.allowDuplicate || Boolean(supersedesId),
    },
    trx,
  );
}

export async function createExpense(userId: string, input: ExpenseInput, conn?: Knex.Transaction) {
  const run = async (trx: Knex.Transaction) => {
    const txn = await postExpenseEntry(userId, input, trx);
    const [record] = await trx('expense_records')
      .insert({
        user_id: userId,
        transaction_id: txn.id,
        gst_amount: input.gstAmount ? storage(input.gstAmount) : null,
        is_tax_deductible: input.isTaxDeductible ?? false,
        tax_section: input.taxSection ?? null,
        is_reimbursable: input.isReimbursable ?? false,
        recurring_rule_id: input.recurringRuleId ?? null,
        notes: input.notes ?? null,
      })
      .returning('*');
    return { record, transaction: txn, warnings: txn.warnings };
  };
  return conn ? run(conn) : withTransaction(run);
}

export async function updateExpense(userId: string, id: string, patch: Partial<ExpenseInput>, reason: string) {
  return withTransaction(async (trx) => {
    const record = await trx('expense_records').where({ id, user_id: userId }).whereNull('deleted_at').forUpdate().first();
    if (!record) throw notFound('Expense');
    const txn = await trx('transactions').where({ id: record.transactionId }).first();
    const merged: ExpenseInput = {
      accountId: patch.accountId ?? txn.accountId,
      amount: patch.amount ?? txn.amount,
      occurredOn: patch.occurredOn ?? txn.occurredOn,
      description: patch.description ?? txn.description,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : txn.categoryId,
      merchantId: patch.merchantName ? null : patch.merchantId !== undefined ? patch.merchantId : txn.merchantId,
      merchantName: patch.merchantName,
      paymentMethodId: patch.paymentMethodId !== undefined ? patch.paymentMethodId : txn.paymentMethodId,
      reference: patch.reference !== undefined ? patch.reference : txn.reference,
      counterparty: txn.counterparty,
      notes: patch.notes !== undefined ? patch.notes : txn.notes,
      tags: patch.tags ?? txn.tags,
    };
    await reverseTransaction(userId, txn.id, reason, trx);
    const replacement = await postExpenseEntry(userId, merged, trx, txn.id);
    const [updated] = await trx('expense_records')
      .where({ id })
      .update({
        transaction_id: replacement.id,
        gst_amount: patch.gstAmount !== undefined ? (patch.gstAmount ? storage(patch.gstAmount) : null) : record.gstAmount,
        is_tax_deductible: patch.isTaxDeductible ?? record.isTaxDeductible,
        tax_section: patch.taxSection !== undefined ? patch.taxSection : record.taxSection,
        is_reimbursable: patch.isReimbursable ?? record.isReimbursable,
        notes: merged.notes ?? null,
      })
      .returning('*');
    return updated;
  });
}

export async function deleteExpense(userId: string, id: string, reason: string) {
  return withTransaction(async (trx) => {
    const record = await trx('expense_records').where({ id, user_id: userId }).whereNull('deleted_at').forUpdate().first();
    if (!record) throw notFound('Expense');
    await reverseTransaction(userId, record.transactionId, reason, trx);
    await trx('expense_records').where({ id }).update({ deleted_at: trx.fn.now() });
  });
}

export function expenseQuery(userId: string) {
  return db('expense_records as e')
    .join('transactions as t', 't.id', 'e.transaction_id')
    .join('accounts as a', 'a.id', 't.account_id')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .leftJoin('merchants as m', 'm.id', 't.merchant_id')
    .leftJoin('payment_methods as p', 'p.id', 't.payment_method_id')
    .where('e.user_id', userId)
    .whereNull('e.deleted_at')
    .select(
      'e.*',
      't.amount',
      't.occurred_on',
      't.description',
      't.account_id',
      't.category_id',
      't.merchant_id',
      't.payment_method_id',
      't.reference',
      't.tags',
      't.metadata',
      'a.name as account_name',
      'c.name as category_name',
      'c.color as category_color',
      'c.icon as category_icon',
      'm.name as merchant_name',
      'p.label as payment_method_label',
      'p.type as payment_method_type',
      db.raw('(SELECT count(*)::int FROM receipts r WHERE r.expense_record_id = e.id) AS receipt_count'),
    );
}

export function serializeExpense(row: Record<string, any>) {
  return { ...row, amount: money(row.amount), gstAmount: row.gstAmount != null ? money(row.gstAmount) : null };
}

/** Expense ledger entries in a period (reversed entries and reversals excluded). */
function spendBase(userId: string, from: string, to: string) {
  return db('transactions as t')
    .where('t.user_id', userId)
    .whereIn('t.kind', ['expense', 'bill_payment', 'fee'])
    .where('t.status', 'posted')
    .whereBetween('t.occurred_on', [from, to]);
}

/** Spending analytics: time series, category roll-up, merchants, payment methods and period comparison. */
export async function expenseAnalytics(userId: string, from: string, to: string, granularity: 'day' | 'week' | 'month') {
  const [totals] = await spendBase(userId, from, to).select(db.raw('COALESCE(SUM(t.amount), 0) AS total'), db.raw('COUNT(*)::int AS count'), db.raw('MAX(t.amount) AS largest'));
  const days = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const [prev] = await spendBase(userId, prevFrom, prevTo).select(db.raw('COALESCE(SUM(t.amount), 0) AS total'));

  const series = await spendBase(userId, from, to)
    .select(db.raw(`to_char(date_trunc('${granularity}', t.occurred_on), 'YYYY-MM-DD') AS period`), db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'))
    .groupByRaw('1')
    .orderBy('period');

  const byCategory = await spendBase(userId, from, to)
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .leftJoin('transaction_categories as pc', 'pc.id', 'c.parent_id')
    .select(
      db.raw('COALESCE(pc.id, c.id) AS category_id'),
      db.raw(`COALESCE(pc.name, c.name, 'Uncategorised') AS name`),
      db.raw('COALESCE(pc.color, c.color) AS color'),
      db.raw('SUM(t.amount) AS total'),
      db.raw('COUNT(*)::int AS count'),
    )
    .groupByRaw('1, 2, 3')
    .orderBy('total', 'desc');

  const byMerchant = await spendBase(userId, from, to)
    .join('merchants as m', 'm.id', 't.merchant_id')
    .select('m.id as merchant_id', 'm.name', db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'))
    .groupBy('m.id', 'm.name')
    .orderBy('total', 'desc')
    .limit(10);

  const byPaymentType = await spendBase(userId, from, to)
    .leftJoin('payment_methods as p', 'p.id', 't.payment_method_id')
    .select(db.raw(`COALESCE(p.type, 'unspecified') AS payment_type`), db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'))
    .groupByRaw('1')
    .orderBy('total', 'desc');

  const [topDay] = await spendBase(userId, from, to).select('t.occurred_on', db.raw('SUM(t.amount) AS total')).groupBy('t.occurred_on').orderBy('total', 'desc').limit(1);

  const total = dec(totals.total);
  const change = dec(prev.total).isZero() ? null : total.minus(prev.total).div(prev.total).times(100).toFixed(2);
  return {
    period: { from, to, days, granularity },
    totals: {
      total: money(total),
      count: totals.count,
      averagePerDay: money(total.div(days)),
      largestExpense: money(totals.largest ?? 0),
      highestSpendDay: topDay ? { date: topDay.occurredOn, total: money(topDay.total) } : null,
    },
    comparison: { previousPeriod: { from: prevFrom, to: prevTo, total: money(prev.total) }, changePercent: change },
    series: series.map((s: any) => ({ period: s.period, total: money(s.total), count: s.count })),
    byCategory: byCategory.map((c: any) => ({ ...c, total: money(c.total), sharePercent: percent(c.total, total) })),
    byMerchant: byMerchant.map((m: any) => ({ ...m, total: money(m.total), sharePercent: percent(m.total, total) })),
    byPaymentType: byPaymentType.map((p: any) => ({ ...p, total: money(p.total), sharePercent: percent(p.total, total) })),
    sumCheck: money(sum(byCategory.map((c: any) => c.total))),
  };
}
