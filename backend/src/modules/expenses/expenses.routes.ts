import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../db/knex';
import { addDays, monthStart, todayIn } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { apiRouter, envelope, idParams, isoDate, optionalText, pageMeta, paginationQuery } from '../../lib/http';
import { nonNegativeMoney, positiveMoney } from '../../lib/money';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { checkBudgetAlertsSoon } from '../notifications/alerts';
import { registerRecurringHandler } from '../recurring/recurring.service';
import { createExpense, deleteExpense, expenseAnalytics, expenseQuery, serializeExpense, updateExpense } from './expenses.service';

const r = apiRouter('/expenses', 'Expenses');

const tags = z.array(z.string().trim().min(1).max(40)).max(10);
const fields = z.object({
  accountId: z.uuid(),
  amount: positiveMoney,
  occurredOn: isoDate,
  description: z.string().trim().min(1).max(500),
  categoryId: z.uuid().nullish(),
  merchantId: z.uuid().nullish(),
  merchantName: optionalText(120),
  paymentMethodId: z.uuid().nullish(),
  reference: optionalText(64),
  notes: optionalText(2000),
  tags,
  gstAmount: nonNegativeMoney.nullish(),
  isTaxDeductible: z.boolean(),
  taxSection: z.enum(['80C', '80D', '80E', '80G', '80GG', '80TTA', '24B', 'HRA', 'other']).nullish(),
  isReimbursable: z.boolean(),
});

registerRecurringHandler('expense', async (rule, date, trx: Knex.Transaction) =>
  createExpense(
    rule.userId,
    {
      accountId: rule.accountId,
      amount: rule.amount,
      occurredOn: date,
      description: rule.description,
      categoryId: rule.categoryId,
      merchantName: rule.merchantName,
      paymentMethodId: rule.paymentMethodId,
      recurringRuleId: rule.id,
      source: 'recurring',
      allowDuplicate: true,
    },
    trx,
  ),
);

r.get('/', {
  summary: 'List expenses',
  query: paginationQuery.extend({
    from: isoDate.optional(),
    to: isoDate.optional(),
    categoryId: z.uuid().optional(),
    merchantId: z.uuid().optional(),
    accountId: z.uuid().optional(),
    paymentType: z.string().max(20).optional(),
    search: z.string().trim().max(100).optional(),
  }),
  handler: async ({ user, query }) => {
    const q = expenseQuery(user.id);
    if (query.from) q.where('t.occurred_on', '>=', query.from);
    if (query.to) q.where('t.occurred_on', '<=', query.to);
    if (query.categoryId) q.where((w) => w.where('t.category_id', query.categoryId!).orWhere('c.parent_id', query.categoryId!));
    if (query.merchantId) q.where('t.merchant_id', query.merchantId);
    if (query.accountId) q.where('t.account_id', query.accountId);
    if (query.paymentType) q.where('p.type', query.paymentType);
    if (query.search) q.where((w) => w.whereILike('t.description', `%${query.search}%`).orWhereILike('m.name', `%${query.search}%`));
    const [{ c }] = await db.from(q.clone().as('x')).count({ c: '*' });
    const rows = await q.orderBy([{ column: 't.occurred_on', order: 'desc' }, { column: 'e.created_at', order: 'desc' }]).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return envelope(rows.map(serializeExpense), pageMeta(query, Number(c)));
  },
});

r.get('/analytics', {
  summary: 'Spending analytics (daily, weekly or monthly) with category, merchant and payment-mode breakdowns',
  query: z.object({ from: isoDate.optional(), to: isoDate.optional(), granularity: z.enum(['day', 'week', 'month']).default('day') }),
  handler: ({ user, query }) => {
    const today = todayIn();
    const from = query.from ?? (query.granularity === 'month' ? addDays(today, -364) : monthStart(today));
    return expenseAnalytics(user.id, from, query.to ?? today, query.granularity);
  },
});

r.post('/', {
  summary: 'Record an expense (auto-categorised when no category is given)',
  status: 201,
  body: guarded(
    fields.extend({
      occurredOn: isoDate.default(() => todayIn()),
      tags: tags.default([]),
      isTaxDeductible: z.boolean().default(false),
      isReimbursable: z.boolean().default(false),
      allowDuplicate: z.boolean().default(false),
    }),
  ),
  handler: async ({ user, body, req }) => {
    const { record, warnings } = await createExpense(user.id, body);
    await audit({ action: 'expense.created', req, entityType: 'expense_record', entityId: record.id });
    checkBudgetAlertsSoon(user.id, body.occurredOn);
    const [row] = await expenseQuery(user.id).where('e.id', record.id);
    return { ...serializeExpense(row), warnings };
  },
});

r.get('/:id', {
  summary: 'Expense details with splits and receipts',
  params: idParams,
  handler: async ({ user, params }) => {
    const [row] = await expenseQuery(user.id).where('e.id', params.id);
    if (!row) throw notFound('Expense');
    const splits = await db('expense_splits').where({ expense_record_id: params.id }).orderBy('created_at');
    const receipts = await db('receipts').where({ expense_record_id: params.id }).select('id', 'original_filename', 'mime_type', 'size_bytes', 'uploaded_at');
    return { ...serializeExpense(row), splits, receipts };
  },
});

r.put('/:id', {
  summary: 'Edit an expense (reverses the original ledger entry and posts a corrected one)',
  params: idParams,
  body: guarded(fields.partial().extend({ reason: z.string().trim().min(3).max(500).default('Edited expense') })),
  handler: async ({ user, params, body, req }) => {
    const { reason, ...patch } = body;
    await updateExpense(user.id, params.id, patch, reason);
    await audit({ action: 'expense.corrected', req, entityType: 'expense_record', entityId: params.id, metadata: { reason } });
    const [row] = await expenseQuery(user.id).where('e.id', params.id);
    return serializeExpense(row);
  },
});

r.delete('/:id', {
  summary: 'Delete an expense (its ledger entry is reversed)',
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500).default('Deleted expense') }),
  handler: async ({ user, params, body, req }) => {
    await deleteExpense(user.id, params.id, body.reason);
    await audit({ action: 'expense.deleted', req, entityType: 'expense_record', entityId: params.id });
    return undefined;
  },
});

export default r.router;
