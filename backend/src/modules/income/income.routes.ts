import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../db/knex';
import { financialYear, todayIn } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { apiRouter, envelope, idParams, isoDate, isoMonth, optionalText, pageMeta, paginationQuery } from '../../lib/http';
import { money, nonNegativeMoney, positiveMoney } from '../../lib/money';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { registerRecurringHandler } from '../recurring/recurring.service';
import { createIncome, deleteIncome, INCOME_SOURCES, incomeQuery, incomeSummary, updateIncome, type IncomeSource } from './income.service';

const r = apiRouter('/income', 'Income');

const fields = z.object({
  accountId: z.uuid(),
  sourceType: z.enum(INCOME_SOURCES),
  grossAmount: positiveMoney,
  taxDeducted: nonNegativeMoney,
  otherDeductions: nonNegativeMoney,
  occurredOn: isoDate,
  payerName: optionalText(120),
  description: optionalText(500),
  categoryId: z.uuid().nullish(),
  periodMonth: isoMonth.nullish(),
  isTaxable: z.boolean(),
  paymentMethodId: z.uuid().nullish(),
  reference: optionalText(64),
  notes: optionalText(2000),
});

function serialize(row: Record<string, any>) {
  return { ...row, grossAmount: money(row.grossAmount), taxDeducted: money(row.taxDeducted), otherDeductions: money(row.otherDeductions), netAmount: money(row.netAmount) };
}

registerRecurringHandler('income', async (rule, date, trx: Knex.Transaction) =>
  createIncome(
    rule.userId,
    {
      accountId: rule.accountId,
      sourceType: (rule.incomeSource ?? 'other') as IncomeSource,
      grossAmount: rule.amount,
      occurredOn: date,
      description: rule.description,
      categoryId: rule.categoryId,
      paymentMethodId: rule.paymentMethodId,
      periodMonth: date.slice(0, 7),
      recurringRuleId: rule.id,
      source: 'recurring',
    },
    trx,
  ),
);

r.get('/', {
  summary: 'List income records',
  query: paginationQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), sourceType: z.enum(INCOME_SOURCES).optional(), accountId: z.uuid().optional() }),
  handler: async ({ user, query }) => {
    const q = incomeQuery(user.id);
    if (query.from) q.where('t.occurred_on', '>=', query.from);
    if (query.to) q.where('t.occurred_on', '<=', query.to);
    if (query.sourceType) q.where('i.source_type', query.sourceType);
    if (query.accountId) q.where('t.account_id', query.accountId);
    const total = (await db.from(q.clone().as('x')).count({ c: '*' }))[0].c;
    const rows = await q.orderBy('t.occurred_on', 'desc').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return envelope(rows.map(serialize), pageMeta(query, Number(total)));
  },
});

r.get('/summary', {
  summary: 'Monthly and per-source income report (defaults to the current financial year)',
  query: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  handler: ({ user, query }) => {
    const fy = financialYear(todayIn());
    return incomeSummary(user.id, query.from ?? fy.start, query.to ?? fy.end);
  },
});

r.post('/', {
  summary: 'Record income (gross, TDS and other deductions; the net amount is credited)',
  status: 201,
  body: guarded(
    fields.extend({
      taxDeducted: nonNegativeMoney.default('0'),
      otherDeductions: nonNegativeMoney.default('0'),
      occurredOn: isoDate.default(() => todayIn()),
      isTaxable: z.boolean().optional(),
    }),
  ),
  handler: async ({ user, body, req }) => {
    const { record, warnings } = await createIncome(user.id, body);
    await audit({ action: 'income.created', req, entityType: 'income_record', entityId: record.id, metadata: { net: record.netAmount } });
    const [row] = await incomeQuery(user.id).where('i.id', record.id);
    return { ...serialize(row), warnings };
  },
});

r.get('/:id', {
  summary: 'Income record details',
  params: idParams,
  handler: async ({ user, params }) => {
    const [row] = await incomeQuery(user.id).where('i.id', params.id);
    if (!row) throw notFound('Income record');
    return serialize(row);
  },
});

r.put('/:id', {
  summary: 'Correct an income record (ledger entry is reversed and re-posted)',
  params: idParams,
  body: guarded(fields.partial().extend({ reason: z.string().trim().min(3).max(500).default('Edited income record') })),
  handler: async ({ user, params, body, req }) => {
    const { reason, ...patch } = body;
    const updated = await updateIncome(user.id, params.id, patch, reason);
    await audit({ action: 'income.corrected', req, entityType: 'income_record', entityId: params.id, metadata: { reason } });
    const [row] = await incomeQuery(user.id).where('i.id', updated.id);
    return serialize(row);
  },
});

r.delete('/:id', {
  summary: 'Delete an income record (its ledger entry is reversed)',
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500).default('Deleted income record') }),
  handler: async ({ user, params, body, req }) => {
    await deleteIncome(user.id, params.id, body.reason);
    await audit({ action: 'income.deleted', req, entityType: 'income_record', entityId: params.id });
    return undefined;
  },
});

export default r.router;
