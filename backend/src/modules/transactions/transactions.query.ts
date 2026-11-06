import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../db/knex';
import { isoDate, paginationQuery, queryBool } from '../../lib/http';
import { dec, money, moneySchema } from '../../lib/money';

export const transactionFilters = paginationQuery.extend({
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  merchantId: z.uuid().optional(),
  paymentMethodId: z.uuid().optional(),
  paymentType: z.enum(['cash', 'upi', 'debit_card', 'credit_card', 'net_banking', 'wallet', 'cheque', 'other']).optional(),
  kind: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
  direction: z.enum(['credit', 'debit']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  minAmount: moneySchema.optional(),
  maxAmount: moneySchema.optional(),
  includeReversed: queryBool.optional(),
  upiOnly: queryBool.optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
});

export type TransactionFilters = z.infer<typeof transactionFilters>;

/** Base ledger query with the joins used by list views. */
export function ledgerQuery(userId: string): Knex.QueryBuilder {
  return db('transactions as t')
    .join('accounts as a', 'a.id', 't.account_id')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .leftJoin('merchants as m', 'm.id', 't.merchant_id')
    .leftJoin('payment_methods as p', 'p.id', 't.payment_method_id')
    .where('t.user_id', userId);
}

export function applyFilters(q: Knex.QueryBuilder, f: Partial<TransactionFilters>): Knex.QueryBuilder {
  if (f.accountId) q.where('t.account_id', f.accountId);
  if (f.categoryId) {
    // Include sub-categories of the chosen category.
    q.where((w) => w.where('t.category_id', f.categoryId!).orWhere('c.parent_id', f.categoryId!));
  }
  if (f.merchantId) q.where('t.merchant_id', f.merchantId);
  if (f.paymentMethodId) q.where('t.payment_method_id', f.paymentMethodId);
  if (f.paymentType) q.where('p.type', f.paymentType);
  if (f.upiOnly) q.where((w) => w.where('p.type', 'upi').orWhereRaw(`t.metadata->>'channel' = 'upi'`));
  if (f.kind) q.whereIn('t.kind', f.kind.split(','));
  if (f.direction) q.where('t.direction', f.direction);
  if (f.from) q.where('t.occurred_on', '>=', f.from);
  if (f.to) q.where('t.occurred_on', '<=', f.to);
  if (f.minAmount) q.where('t.amount', '>=', f.minAmount);
  if (f.maxAmount) q.where('t.amount', '<=', f.maxAmount);
  if (f.tag) q.whereRaw('? = ANY(t.tags)', [f.tag]);
  if (f.search) {
    const like = `%${f.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    q.where((w) =>
      w.whereILike('t.description', like).orWhereILike('t.notes', like).orWhereILike('t.reference', like).orWhereILike('t.counterparty', like).orWhereILike('m.name', like),
    );
  }
  if (!f.includeReversed) q.where('t.status', 'posted').whereNot('t.kind', 'reversal');
  return q;
}

const SORTS: Record<TransactionFilters['sort'], Array<{ column: string; order: 'asc' | 'desc' }>> = {
  date_desc: [{ column: 't.occurred_on', order: 'desc' }, { column: 't.posted_at', order: 'desc' }],
  date_asc: [{ column: 't.occurred_on', order: 'asc' }, { column: 't.posted_at', order: 'asc' }],
  amount_desc: [{ column: 't.amount', order: 'desc' }, { column: 't.occurred_on', order: 'desc' }],
  amount_asc: [{ column: 't.amount', order: 'asc' }, { column: 't.occurred_on', order: 'desc' }],
};

export async function listTransactions(userId: string, f: TransactionFilters) {
  const base = applyFilters(ledgerQuery(userId), f);
  const [totals] = await base
    .clone()
    .select(
      db.raw('count(*)::int AS total'),
      db.raw(`COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'credit'), 0) AS credits`),
      db.raw(`COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'debit'), 0) AS debits`),
    );
  const rows = await base
    .clone()
    .select(
      't.*',
      'a.name as account_name',
      'a.type as account_type',
      'c.name as category_name',
      'c.icon as category_icon',
      'c.color as category_color',
      'm.name as merchant_name',
      'p.label as payment_method_label',
      'p.type as payment_method_type',
    )
    .orderBy(SORTS[f.sort])
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  return {
    rows,
    total: Number(totals.total),
    totals: { credits: money(totals.credits), debits: money(totals.debits), net: money(dec(totals.credits).minus(totals.debits)) },
  };
}
