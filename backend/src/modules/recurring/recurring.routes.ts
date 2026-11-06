import { z } from 'zod';
import { db } from '../../db/knex';
import { badRequest, notFound, unprocessable } from '../../lib/errors';
import { addDays, todayIn } from '../../lib/dates';
import { apiRouter, idParams, isoDate, optionalText } from '../../lib/http';
import { money, positiveMoney, sum } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { resolveCategory } from '../categories/categories.service';
import { INCOME_SOURCES } from '../income/income.service';
import { processDueRules, upcomingDates, type RecurringRule } from './recurring.service';

const r = apiRouter('/recurring-rules', 'Recurring');

const fields = z.object({
  kind: z.enum(['income', 'expense']),
  name: z.string().trim().min(2).max(80),
  accountId: z.uuid(),
  amount: positiveMoney,
  categoryId: z.uuid().nullish(),
  paymentMethodId: z.uuid().nullish(),
  incomeSource: z.enum(INCOME_SOURCES).nullish(),
  merchantName: optionalText(120),
  description: z.string().trim().min(1).max(500),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  intervalCount: z.number().int().min(1).max(24),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  autoPost: z.boolean(),
  isActive: z.boolean(),
});

function toRow(v: Partial<z.infer<typeof fields>>) {
  return Object.fromEntries(
    Object.entries({
      kind: v.kind,
      name: v.name,
      account_id: v.accountId,
      amount: v.amount,
      category_id: v.categoryId,
      payment_method_id: v.paymentMethodId,
      income_source: v.incomeSource,
      merchant_name: v.merchantName,
      description: v.description,
      frequency: v.frequency,
      interval_count: v.intervalCount,
      start_date: v.startDate,
      end_date: v.endDate,
      auto_post: v.autoPost,
      is_active: v.isActive,
    }).filter(([, val]) => val !== undefined),
  );
}

async function validateRefs(userId: string, v: Partial<z.infer<typeof fields>>, kind?: 'income' | 'expense') {
  await requireOwnedRef('accounts', v.accountId, userId, 'accountId');
  await requireOwnedRef('payment_methods', v.paymentMethodId, userId, 'paymentMethodId');
  if (v.categoryId) await resolveCategory(userId, v.categoryId, kind ?? v.kind);
  if (v.endDate && v.startDate && v.endDate < v.startDate) throw unprocessable('End date must be after the start date');
}

r.get('/', {
  summary: 'List recurring income and expense schedules',
  query: z.object({ kind: z.enum(['income', 'expense']).optional() }),
  handler: async ({ user, query }) => {
    const q = db('recurring_rules as r')
      .join('accounts as a', 'a.id', 'r.account_id')
      .leftJoin('transaction_categories as c', 'c.id', 'r.category_id')
      .where('r.user_id', user.id)
      .select('r.*', 'a.name as account_name', 'c.name as category_name')
      .orderBy([{ column: 'r.is_active', order: 'desc' }, { column: 'r.next_run_on' }]);
    if (query.kind) q.where('r.kind', query.kind);
    return q;
  },
});

r.get('/upcoming', {
  summary: 'Projected recurring entries for the next N days',
  query: z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }),
  handler: async ({ user, query }) => {
    const until = addDays(todayIn(), query.days);
    const rules: RecurringRule[] = await db('recurring_rules').where({ user_id: user.id, is_active: true });
    const items = rules
      .flatMap((rule) => upcomingDates(rule, until).map((date) => ({ ruleId: rule.id, name: rule.name, kind: rule.kind, date, amount: money(rule.amount) })))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      until,
      items,
      totals: {
        income: money(sum(items.filter((i) => i.kind === 'income').map((i) => i.amount))),
        expense: money(sum(items.filter((i) => i.kind === 'expense').map((i) => i.amount))),
      },
    };
  },
});

r.post('/', {
  summary: 'Create a recurring schedule',
  status: 201,
  body: fields.extend({ intervalCount: fields.shape.intervalCount.default(1), autoPost: fields.shape.autoPost.default(true), isActive: fields.shape.isActive.default(true) }),
  handler: async ({ user, body }) => {
    if (body.kind === 'income' && !body.incomeSource) throw unprocessable('Choose the income source', { field: 'incomeSource' });
    await validateRefs(user.id, body);
    const [row] = await db('recurring_rules').insert({ user_id: user.id, ...toRow(body), next_run_on: body.startDate }).returning('*');
    return row;
  },
});

r.patch('/:id', {
  summary: 'Update a recurring schedule',
  params: idParams,
  body: fields.omit({ kind: true }).partial(),
  handler: async ({ user, params, body }) => {
    const rule = await db('recurring_rules').where({ id: params.id, user_id: user.id }).first();
    if (!rule) throw notFound('Recurring rule');
    await validateRefs(user.id, { ...body, startDate: body.startDate ?? rule.startDate }, rule.kind);
    const patch = toRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    if (body.startDate && !rule.lastRunOn) patch.next_run_on = body.startDate;
    const [row] = await db('recurring_rules').where({ id: params.id }).update(patch).returning('*');
    return row;
  },
});

r.delete('/:id', {
  summary: 'Delete a recurring schedule (already posted entries are kept)',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('recurring_rules').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Recurring rule');
    return undefined;
  },
});

r.post('/run-due', {
  summary: 'Post any of your schedules that are due today (normally done by the scheduler)',
  handler: ({ user }) => processDueRules(todayIn(), { userId: user.id }),
});

export default r.router;
