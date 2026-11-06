import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { conflict, notFound } from '../../lib/errors';
import { apiRouter, idParams, isoMonth, optionalText } from '../../lib/http';
import { dec, money, nonNegativeMoney, positiveMoney } from '../../lib/money';
import { audit } from '../audit/audit.service';
import { resolveCategory } from '../categories/categories.service';
import { budgetHistory, budgetUtilization } from './budgets.service';

const r = apiRouter('/budgets', 'Budgets');

const line = z.object({ categoryId: z.uuid(), limitAmount: positiveMoney, alertThresholdPct: z.number().int().min(1).max(100).default(80) });
const header = z.object({
  name: z.string().trim().min(2).max(80),
  totalLimit: positiveMoney.nullish(),
  savingsTarget: nonNegativeMoney.nullish(),
  expectedIncome: nonNegativeMoney.nullish(),
  notes: optionalText(1000),
});

const monthDate = (m: string) => `${m}-01`;

async function upsertLines(userId: string, budgetId: string, lines: z.infer<typeof line>[], trx: typeof db | any) {
  for (const l of lines) {
    await resolveCategory(userId, l.categoryId, 'expense', trx);
    await trx('budget_categories')
      .insert({ user_id: userId, budget_id: budgetId, category_id: l.categoryId, limit_amount: l.limitAmount, alert_threshold_pct: l.alertThresholdPct })
      .onConflict(['budget_id', 'category_id'])
      .merge(['limit_amount', 'alert_threshold_pct']);
  }
}

r.get('/', {
  summary: 'List budgets, or fetch the budget for one month with utilisation',
  query: z.object({ month: isoMonth.optional() }),
  handler: async ({ user, query }) => {
    if (query.month) {
      const b = await db('budgets').where({ user_id: user.id, month: monthDate(query.month) }).first('id');
      return b ? budgetUtilization(user.id, b.id) : null;
    }
    const rows = await db('budgets as b')
      .leftJoin('budget_categories as l', 'l.budget_id', 'b.id')
      .where('b.user_id', user.id)
      .groupBy('b.id')
      .select('b.*', db.raw('COUNT(l.id)::int AS category_count'), db.raw('COALESCE(SUM(l.limit_amount), 0) AS category_limit_total'))
      .orderBy('b.month', 'desc');
    return rows.map((b: any) => ({ ...b, month: String(b.month).slice(0, 7), categoryLimitTotal: money(b.categoryLimitTotal) }));
  },
});

r.get('/history', {
  summary: 'Historical budget performance',
  query: z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }),
  handler: ({ user, query }) => budgetHistory(user.id, query.months),
});

r.get('/compare', {
  summary: 'Compare two monthly budgets category by category',
  query: z.object({ a: isoMonth, b: isoMonth }),
  handler: async ({ user, query }) => {
    const load = async (m: string) => {
      const b = await db('budgets').where({ user_id: user.id, month: monthDate(m) }).first('id');
      if (!b) throw notFound(`Budget for ${m}`);
      return budgetUtilization(user.id, b.id);
    };
    const [a, b] = await Promise.all([load(query.a), load(query.b)]);
    const names = new Set([...a.categories.map((c) => c.name), ...b.categories.map((c) => c.name)]);
    return {
      a: { month: a.month, totals: a.totals },
      b: { month: b.month, totals: b.totals },
      categories: [...names].map((name) => {
        const ca = a.categories.find((c) => c.name === name);
        const cb = b.categories.find((c) => c.name === name);
        return {
          name,
          a: ca ? { limit: ca.limit, spent: ca.spent } : null,
          b: cb ? { limit: cb.limit, spent: cb.spent } : null,
          spentChange: money(dec(cb?.spent ?? 0).minus(ca?.spent ?? 0)),
        };
      }),
    };
  },
});

r.post('/', {
  summary: 'Create a monthly budget with category limits',
  status: 201,
  body: header.extend({ month: isoMonth, name: header.shape.name.optional(), categories: z.array(line).max(50).default([]) }),
  handler: async ({ user, body, req }) => {
    const budget = await withTransaction(async (trx) => {
      const exists = await trx('budgets').where({ user_id: user.id, month: monthDate(body.month) }).first('id');
      if (exists) throw conflict(`A budget for ${body.month} already exists`);
      const [row] = await trx('budgets')
        .insert({
          user_id: user.id,
          month: monthDate(body.month),
          name: body.name ?? `Budget ${body.month}`,
          total_limit: body.totalLimit ?? null,
          savings_target: body.savingsTarget ?? null,
          expected_income: body.expectedIncome ?? null,
          notes: body.notes ?? null,
        })
        .returning('*');
      await upsertLines(user.id, row.id, body.categories, trx);
      return row;
    });
    await audit({ action: 'budget.created', req, entityType: 'budget', entityId: budget.id, metadata: { month: body.month } });
    return budgetUtilization(user.id, budget.id);
  },
});

r.get('/:id', {
  summary: 'Budget utilisation, alerts and projections',
  params: idParams,
  handler: ({ user, params }) => budgetUtilization(user.id, params.id),
});

r.put('/:id', {
  summary: 'Update budget totals and targets',
  params: idParams,
  body: header.partial(),
  handler: async ({ user, params, body }) => {
    const patch = Object.fromEntries(
      Object.entries({ name: body.name, total_limit: body.totalLimit, savings_target: body.savingsTarget, expected_income: body.expectedIncome, notes: body.notes }).filter(([, v]) => v !== undefined),
    );
    const [row] = await db('budgets').where({ id: params.id, user_id: user.id }).update(patch).returning('id');
    if (!row) throw notFound('Budget');
    return budgetUtilization(user.id, params.id);
  },
});

r.delete('/:id', {
  summary: 'Delete a budget',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const deleted = await db('budgets').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Budget');
    await audit({ action: 'budget.deleted', req, entityType: 'budget', entityId: params.id });
    return undefined;
  },
});

r.put('/:id/categories', {
  summary: 'Add or update category limits',
  params: idParams,
  body: z.object({ categories: z.array(line).min(1).max(50) }),
  handler: async ({ user, params, body }) => {
    const budget = await db('budgets').where({ id: params.id, user_id: user.id }).first('id');
    if (!budget) throw notFound('Budget');
    await withTransaction((trx) => upsertLines(user.id, params.id, body.categories, trx));
    return budgetUtilization(user.id, params.id);
  },
});

r.delete('/:id/categories/:categoryId', {
  summary: 'Remove a category limit',
  params: z.object({ id: z.uuid(), categoryId: z.uuid() }),
  handler: async ({ user, params }) => {
    const deleted = await db('budget_categories').where({ budget_id: params.id, category_id: params.categoryId, user_id: user.id }).delete();
    if (!deleted) throw notFound('Budget category');
    return undefined;
  },
});

r.post('/:id/copy', {
  summary: 'Copy this budget (limits and targets) to another month',
  status: 201,
  params: idParams,
  body: z.object({ toMonth: isoMonth }),
  handler: async ({ user, params, body }) => {
    const source = await db('budgets').where({ id: params.id, user_id: user.id }).first();
    if (!source) throw notFound('Budget');
    const copy = await withTransaction(async (trx) => {
      const exists = await trx('budgets').where({ user_id: user.id, month: monthDate(body.toMonth) }).first('id');
      if (exists) throw conflict(`A budget for ${body.toMonth} already exists`);
      const [row] = await trx('budgets')
        .insert({ user_id: user.id, month: monthDate(body.toMonth), name: `Budget ${body.toMonth}`, total_limit: source.totalLimit, savings_target: source.savingsTarget, expected_income: source.expectedIncome, notes: source.notes })
        .returning('*');
      const lines = await trx('budget_categories').where({ budget_id: params.id });
      if (lines.length) {
        await trx('budget_categories').insert(lines.map((l: any) => ({ user_id: user.id, budget_id: row.id, category_id: l.categoryId, limit_amount: l.limitAmount, alert_threshold_pct: l.alertThresholdPct })));
      }
      return row;
    });
    return budgetUtilization(user.id, copy.id);
  },
});

export default r.router;
