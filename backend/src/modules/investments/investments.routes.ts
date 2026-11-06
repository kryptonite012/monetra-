import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { todayIn } from '../../lib/dates';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { nonNegativeMoney, positiveMoney, rateSchema } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { decorateInvestment, investmentDetails, portfolio, recordInvestmentTransaction } from './investments.service';

const r = apiRouter('/investments', 'Investments');

const TYPES = ['stock', 'mutual_fund', 'etf', 'fixed_deposit', 'recurring_deposit', 'gold', 'sovereign_gold_bond', 'bond', 'ppf', 'epf', 'nps', 'crypto', 'real_estate_fund', 'other'] as const;
const units = z.union([z.string().trim(), z.number()]).transform(String).refine((v) => /^\d{1,15}(\.\d{1,8})?$/.test(v), 'Units must be a positive number with up to 8 decimals');
const price = z.union([z.string().trim(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,6})?$/.test(v), 'Price must be a positive number with up to 6 decimals');

const meta = z.object({
  name: z.string().trim().min(2).max(120),
  symbol: z.string().trim().toUpperCase().max(30).nullish(),
  isin: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, 'Enter a valid 12-character ISIN').nullish(),
  schemeCode: z.string().trim().regex(/^\d{3,10}$/, 'AMFI scheme codes are numeric').nullish(),
  exchange: z.enum(['NSE', 'BSE', 'OTHER']).nullish(),
  folioOrAccount: z.string().trim().max(40).nullish(),
  riskLevel: z.enum(['low', 'moderate', 'high', 'very_high']).nullish(),
  interestRate: rateSchema.nullish(),
  compoundingPerYear: z.number().int().min(1).max(12).nullish(),
  startDate: isoDate.nullish(),
  maturityDate: isoDate.nullish(),
  maturityAmount: positiveMoney.nullish(),
  notes: optionalText(1000),
});

function metaRow(v: Partial<z.infer<typeof meta>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      symbol: v.symbol,
      isin: v.isin,
      scheme_code: v.schemeCode,
      exchange: v.exchange,
      folio_or_account: v.folioOrAccount,
      risk_level: v.riskLevel,
      interest_rate: v.interestRate,
      compounding_per_year: v.compoundingPerYear,
      start_date: v.startDate,
      maturity_date: v.maturityDate,
      maturity_amount: v.maturityAmount,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

const txnBody = z.object({
  type: z.enum(['buy', 'sell', 'dividend', 'interest', 'bonus', 'split', 'fee']),
  tradeDate: isoDate.default(() => todayIn()),
  units: units.optional(),
  price: price.optional(),
  amount: positiveMoney.optional(),
  fees: nonNegativeMoney.default('0'),
  cashAccountId: z.uuid().nullish(),
  notes: optionalText(500),
});

r.get('/', {
  summary: 'Holdings with valuation, P&L and price-source labels',
  query: z.object({ includeClosed: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('investments').where({ user_id: user.id }).orderBy('name');
    if (!query.includeClosed) q.where({ status: 'active' });
    return (await q).map(decorateInvestment);
  },
});

r.get('/portfolio', {
  summary: 'Portfolio totals, allocation, XIRR and data-source disclosure',
  handler: ({ user }) => portfolio(user.id),
});

r.post('/', {
  summary: 'Add a holding (optionally with its first purchase)',
  status: 201,
  body: guarded(meta.extend({ instrumentType: z.enum(TYPES), initial: txnBody.omit({ type: true }).optional() })),
  handler: async ({ user, body, req }) => {
    const { initial, instrumentType, ...rest } = body;
    if (rest.maturityDate && rest.startDate && rest.maturityDate < rest.startDate) throw unprocessable('Maturity date must be after the start date');
    if (initial?.cashAccountId) await requireOwnedRef('accounts', initial.cashAccountId, user.id, 'cashAccountId');
    const id = await withTransaction(async (trx) => {
      const [inv] = await trx('investments')
        .insert({ user_id: user.id, instrument_type: instrumentType, ...metaRow(rest), start_date: rest.startDate ?? initial?.tradeDate ?? null })
        .returning('id');
      if (initial) await recordInvestmentTransaction(user.id, inv.id, { ...initial, type: 'buy' }, trx);
      return inv.id as string;
    });
    await audit({ action: 'investment.created', req, entityType: 'investment', entityId: id, metadata: { instrumentType } });
    return investmentDetails(user.id, id);
  },
});

r.get('/:id', {
  summary: 'Holding details with transactions and XIRR',
  params: idParams,
  handler: ({ user, params }) => investmentDetails(user.id, params.id),
});

r.patch('/:id', {
  summary: 'Update holding details',
  params: idParams,
  body: guarded(meta.partial()),
  handler: async ({ user, params, body }) => {
    const patch = metaRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('investments').where({ id: params.id, user_id: user.id }).update(patch).returning('id');
    if (!row) throw notFound('Investment');
    return investmentDetails(user.id, params.id);
  },
});

r.post('/:id/transactions', {
  summary: 'Record a buy, sell, dividend, interest, bonus, split or fee',
  status: 201,
  params: idParams,
  body: txnBody,
  handler: async ({ user, params, body, req }) => {
    if (body.cashAccountId) await requireOwnedRef('accounts', body.cashAccountId, user.id, 'cashAccountId');
    const row = await recordInvestmentTransaction(user.id, params.id, body);
    await audit({ action: `investment.${body.type}`, req, entityType: 'investment', entityId: params.id, metadata: { amount: row.amount } });
    return investmentDetails(user.id, params.id);
  },
});

r.post('/:id/price', {
  summary: 'Set a manual price (labelled as manually entered)',
  params: idParams,
  body: z.object({ price, asOf: isoDate.default(() => todayIn()) }),
  handler: async ({ user, params, body }) => {
    const [row] = await db('investments')
      .where({ id: params.id, user_id: user.id })
      .update({ current_price: body.price, price_source: 'manual', price_provider: null, price_as_of: new Date(`${body.asOf}T00:00:00Z`) })
      .returning('id');
    if (!row) throw notFound('Investment');
    return investmentDetails(user.id, params.id);
  },
});

r.delete('/:id', {
  summary: 'Delete a holding that has no ledger-linked transactions',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const inv = await db('investments').where({ id: params.id, user_id: user.id }).first('id');
    if (!inv) throw notFound('Investment');
    const linked = await db('investment_transactions').where({ investment_id: params.id }).whereNotNull('transaction_id').first('id');
    if (linked) throw conflict('This holding has ledger entries; sell or close it instead');
    await db('investments').where({ id: params.id }).delete();
    await audit({ action: 'investment.deleted', req, entityType: 'investment', entityId: params.id });
    return undefined;
  },
});

export default r.router;
