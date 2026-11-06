import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { todayIn } from '../../lib/dates';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { dec, money, nonNegativeMoney, positiveMoney, rateSchema, storage } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { audit } from '../audit/audit.service';
import { categoryBySlug } from '../categories/categories.service';
import { computeNetWorth, netWorthHistory, snapshotNetWorth } from '../networth/networth.service';
import { postTransaction } from '../transactions/ledger.service';

// ------------------------------------------------------------------ assets
export const assets = apiRouter('/assets', 'Assets & liabilities');

const ASSET_TYPES = ['real_estate', 'land', 'vehicle', 'gold', 'jewellery', 'business', 'collectible', 'electronics', 'receivable', 'other'] as const;
const assetFields = z.object({
  name: z.string().trim().min(2).max(120),
  assetType: z.enum(ASSET_TYPES),
  purchaseValue: nonNegativeMoney.nullish(),
  purchaseDate: isoDate.nullish(),
  currentValue: nonNegativeMoney,
  valuationDate: isoDate,
  valuationSource: z.enum(['manual', 'appraisal', 'calculated']),
  annualChangeRate: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d{1,2}(\.\d{1,4})?$/.test(v), 'Rate between -99 and 99').nullish(),
  includeInNetWorth: z.boolean(),
  linkedLoanId: z.uuid().nullish(),
  notes: optionalText(1000),
});

function assetRow(v: Partial<z.infer<typeof assetFields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      asset_type: v.assetType,
      purchase_value: v.purchaseValue,
      purchase_date: v.purchaseDate,
      current_value: v.currentValue,
      valuation_date: v.valuationDate,
      valuation_source: v.valuationSource,
      annual_change_rate: v.annualChangeRate,
      include_in_net_worth: v.includeInNetWorth,
      linked_loan_id: v.linkedLoanId,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

function serializeAsset(a: Record<string, any>) {
  const gain = a.purchaseValue != null ? dec(a.currentValue).minus(a.purchaseValue) : null;
  return {
    ...a,
    currentValue: money(a.currentValue),
    purchaseValue: a.purchaseValue != null ? money(a.purchaseValue) : null,
    gain: gain ? money(gain) : null,
    gainPercent: gain && dec(a.purchaseValue).gt(0) ? gain.div(a.purchaseValue).times(100).toFixed(2) : null,
  };
}

assets.get('/', {
  summary: 'Asset register (property, vehicles, gold and more)',
  query: z.object({ includeDisposed: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('assets').where({ user_id: user.id }).orderBy('current_value', 'desc');
    if (!query.includeDisposed) q.whereNull('disposed_on');
    return (await q).map(serializeAsset);
  },
});

assets.post('/', {
  summary: 'Add an asset',
  status: 201,
  body: assetFields.extend({ valuationDate: isoDate.default(() => todayIn()), valuationSource: assetFields.shape.valuationSource.default('manual'), includeInNetWorth: z.boolean().default(true) }),
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('loans', body.linkedLoanId, user.id, 'linkedLoanId');
    const [row] = await db('assets').insert({ user_id: user.id, ...assetRow(body) }).returning('*');
    await audit({ action: 'asset.created', req, entityType: 'asset', entityId: row.id });
    return serializeAsset(row);
  },
});

assets.patch('/:id', {
  summary: 'Update an asset',
  params: idParams,
  body: assetFields.partial(),
  handler: async ({ user, params, body }) => {
    await requireOwnedRef('loans', body.linkedLoanId, user.id, 'linkedLoanId');
    const patch = assetRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('assets').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Asset');
    return serializeAsset(row);
  },
});

assets.post('/:id/revalue', {
  summary: 'Record a new valuation',
  params: idParams,
  body: z.object({ currentValue: nonNegativeMoney, valuationDate: isoDate.default(() => todayIn()), valuationSource: z.enum(['manual', 'appraisal', 'calculated']).default('manual') }),
  handler: async ({ user, params, body, req }) => {
    const [row] = await db('assets')
      .where({ id: params.id, user_id: user.id })
      .update({ current_value: body.currentValue, valuation_date: body.valuationDate, valuation_source: body.valuationSource })
      .returning('*');
    if (!row) throw notFound('Asset');
    await audit({ action: 'asset.revalued', req, entityType: 'asset', entityId: params.id, metadata: { currentValue: body.currentValue } });
    return serializeAsset(row);
  },
});

assets.post('/:id/dispose', {
  summary: 'Mark an asset as sold or disposed (optionally crediting the sale proceeds)',
  params: idParams,
  body: z.object({ disposedOn: isoDate.default(() => todayIn()), disposalValue: nonNegativeMoney, accountId: z.uuid().optional() }),
  handler: async ({ user, params, body, req }) => {
    return withTransaction(async (trx) => {
      const asset = await trx('assets').where({ id: params.id, user_id: user.id }).first();
      if (!asset) throw notFound('Asset');
      if (asset.disposedOn) throw conflict('This asset is already disposed');
      if (body.accountId && dec(body.disposalValue).gt(0)) {
        await postTransaction(
          { userId: user.id, accountId: body.accountId, kind: 'income', amount: body.disposalValue, occurredOn: body.disposedOn, description: `Sale of ${asset.name}`, categoryId: await categoryBySlug('income.capital_gains', trx), autoCategorize: false, metadata: { assetId: asset.id } },
          trx,
        );
      }
      const [row] = await trx('assets').where({ id: params.id }).update({ disposed_on: body.disposedOn, disposal_value: body.disposalValue }).returning('*');
      await audit({ action: 'asset.disposed', req, entityType: 'asset', entityId: params.id }, trx);
      return serializeAsset(row);
    });
  },
});

assets.delete('/:id', {
  summary: 'Delete an asset record',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('assets').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Asset');
    return undefined;
  },
});

// ------------------------------------------------------------- liabilities
export const liabilities = apiRouter('/liabilities', 'Assets & liabilities');

const LIABILITY_TYPES = ['personal_borrowing', 'family_loan', 'tax_due', 'payable', 'security_deposit', 'bnpl', 'other'] as const;
const liabilityFields = z.object({
  name: z.string().trim().min(2).max(120),
  liabilityType: z.enum(LIABILITY_TYPES),
  counterparty: optionalText(120),
  originalAmount: positiveMoney.nullish(),
  amountOutstanding: nonNegativeMoney,
  interestRate: rateSchema.nullish(),
  dueDate: isoDate.nullish(),
  notes: optionalText(1000),
});

function liabilityRow(v: Partial<z.infer<typeof liabilityFields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      liability_type: v.liabilityType,
      counterparty: v.counterparty,
      original_amount: v.originalAmount,
      amount_outstanding: v.amountOutstanding,
      interest_rate: v.interestRate,
      due_date: v.dueDate,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

const serializeLiability = (l: Record<string, any>) => ({
  ...l,
  amountOutstanding: money(l.amountOutstanding),
  originalAmount: l.originalAmount != null ? money(l.originalAmount) : null,
  overdue: l.status === 'open' && l.dueDate != null && l.dueDate < todayIn(),
});

liabilities.get('/', {
  summary: 'Other liabilities (personal borrowings, dues, payables)',
  query: z.object({ includeSettled: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('liabilities').where({ user_id: user.id }).orderBy([{ column: 'status' }, { column: 'due_date' }]);
    if (!query.includeSettled) q.where({ status: 'open' });
    return (await q).map(serializeLiability);
  },
});

liabilities.post('/', {
  summary: 'Add a liability',
  status: 201,
  body: liabilityFields,
  handler: async ({ user, body, req }) => {
    const [row] = await db('liabilities').insert({ user_id: user.id, ...liabilityRow(body) }).returning('*');
    await audit({ action: 'liability.created', req, entityType: 'liability', entityId: row.id });
    return serializeLiability(row);
  },
});

liabilities.patch('/:id', {
  summary: 'Update a liability',
  params: idParams,
  body: liabilityFields.partial(),
  handler: async ({ user, params, body }) => {
    const patch = liabilityRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('liabilities').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Liability');
    return serializeLiability(row);
  },
});

liabilities.post('/:id/payments', {
  summary: 'Record a repayment (reduces the outstanding amount; optionally posts a ledger debit)',
  params: idParams,
  body: z.object({ amount: positiveMoney, paidOn: isoDate.default(() => todayIn()), accountId: z.uuid().optional() }),
  handler: async ({ user, params, body, req }) => {
    return withTransaction(async (trx) => {
      const l = await trx('liabilities').where({ id: params.id, user_id: user.id }).forUpdate().first();
      if (!l) throw notFound('Liability');
      if (l.status !== 'open') throw conflict('This liability is settled');
      if (dec(body.amount).gt(l.amountOutstanding)) throw unprocessable(`Payment exceeds the outstanding ${money(l.amountOutstanding)}`);
      if (body.accountId) {
        await postTransaction(
          { userId: user.id, accountId: body.accountId, kind: 'loan_repayment', amount: body.amount, occurredOn: body.paidOn, description: `Repayment: ${l.name}`, counterparty: l.counterparty, categoryId: await categoryBySlug('financial.emi', trx), autoCategorize: false, allowDuplicate: true, metadata: { liabilityId: l.id } },
          trx,
        );
      }
      const remaining = dec(l.amountOutstanding).minus(body.amount);
      const [row] = await trx('liabilities')
        .where({ id: params.id })
        .update({ amount_outstanding: storage(remaining), status: remaining.isZero() ? 'settled' : 'open', settled_on: remaining.isZero() ? body.paidOn : null })
        .returning('*');
      await audit({ action: 'liability.payment', req, entityType: 'liability', entityId: params.id, metadata: { amount: body.amount } }, trx);
      return serializeLiability(row);
    });
  },
});

liabilities.delete('/:id', {
  summary: 'Delete a liability record',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('liabilities').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Liability');
    return undefined;
  },
});

// --------------------------------------------------------------- net worth
export const networth = apiRouter('/net-worth', 'Assets & liabilities');

networth.get('/', {
  summary: 'Current net worth with asset and liability breakdown',
  handler: ({ user }) => computeNetWorth(user.id),
});

networth.get('/history', {
  summary: 'Net worth trend from monthly snapshots',
  query: z.object({ months: z.coerce.number().int().min(1).max(120).default(12) }),
  handler: ({ user, query }) => netWorthHistory(user.id, query.months),
});

networth.post('/snapshot', {
  summary: "Save today's net worth snapshot",
  handler: async ({ user }) => {
    const row = await snapshotNetWorth(user.id);
    return { ...row, netWorth: money(row.netWorth) };
  },
});
