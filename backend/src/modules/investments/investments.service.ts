import type { Knex } from 'knex';
import { db, withTransaction } from '../../db/knex';
import { absoluteReturn, accruedValue, xirr, type CashFlow } from '../../engine';
import { daysBetween, todayIn } from '../../lib/dates';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { D, dec, money, percent, storage, sum } from '../../lib/money';
import { categoryBySlug } from '../categories/categories.service';
import { postTransaction } from '../transactions/ledger.service';

export const DEPOSIT_TYPES = new Set(['fixed_deposit', 'recurring_deposit', 'ppf', 'epf', 'nps']);

export const PRICE_SOURCE_LABEL: Record<string, string> = {
  live: 'Live market price',
  delayed: 'Delayed (end-of-day) price',
  manual: 'Manually entered',
  simulated: 'Simulated – not a real price',
  calculated: 'Calculated from interest terms',
};

export interface InvTxnInput {
  type: 'buy' | 'sell' | 'dividend' | 'interest' | 'bonus' | 'split' | 'fee';
  tradeDate: string;
  units?: string;
  price?: string;
  amount?: string;
  fees?: string;
  cashAccountId?: string | null;
  notes?: string | null;
}

/** Values a holding and labels where the number came from. */
export function valueHolding(inv: Record<string, any>) {
  const units = dec(inv.units);
  const invested = dec(inv.investedAmount);
  let currentValue: InstanceType<typeof D>;
  let source: string = inv.priceSource;
  if (inv.currentValueOverride != null) {
    currentValue = dec(inv.currentValueOverride);
  } else if (DEPOSIT_TYPES.has(inv.instrumentType) && inv.interestRate != null && inv.startDate) {
    const today = todayIn();
    const until = inv.maturityDate && inv.maturityDate < today ? inv.maturityDate : today;
    currentValue = accruedValue(invested, inv.interestRate, daysBetween(inv.startDate, until), inv.compoundingPerYear ?? 4);
    source = 'calculated';
  } else if (inv.currentPrice != null) {
    currentValue = units.times(inv.currentPrice);
  } else {
    currentValue = invested;
    source = 'cost_basis';
  }
  const pnl = currentValue.minus(invested);
  return {
    currentValue: money(currentValue),
    unrealizedGain: money(pnl),
    unrealizedGainPercent: absoluteReturn(invested, currentValue)?.toFixed(2) ?? null,
    averageCost: units.gt(0) ? units.isZero() ? null : invested.div(units).toFixed(4) : null,
    valuationSource: source,
    valuationLabel: source === 'cost_basis' ? 'No price yet – shown at cost' : PRICE_SOURCE_LABEL[source],
    priceStale: source !== 'calculated' && inv.priceAsOf ? Date.now() - new Date(inv.priceAsOf).getTime() > 7 * 86_400_000 : source !== 'calculated' && source !== 'cost_basis' && !inv.priceAsOf,
  };
}

export function decorateInvestment(inv: Record<string, any>): Record<string, any> {
  return {
    ...inv,
    units: dec(inv.units).toString(),
    investedAmount: money(inv.investedAmount),
    realizedGain: money(inv.realizedGain),
    ...valueHolding(inv),
  };
}

async function ledgerFor(userId: string, inv: Record<string, any>, input: InvTxnInput, amount: string, trx: Knex.Transaction) {
  if (!input.cashAccountId) return null;
  const kind = input.type === 'buy' || input.type === 'fee' ? 'investment_buy' : input.type === 'sell' ? 'investment_sell' : 'income';
  const categorySlug = input.type === 'dividend' ? 'income.dividends' : input.type === 'interest' ? 'income.interest' : 'transfer.savings';
  const label = { buy: 'Bought', sell: 'Sold', dividend: 'Dividend from', interest: 'Interest from', fee: 'Charges for', bonus: '', split: '' }[input.type];
  return postTransaction(
    {
      userId,
      accountId: input.cashAccountId,
      kind,
      amount,
      occurredOn: input.tradeDate,
      description: `${label} ${inv.name}`.trim(),
      categoryId: await categoryBySlug(categorySlug, trx),
      autoCategorize: false,
      allowDuplicate: true,
      metadata: { investmentId: inv.id },
    },
    trx,
  );
}

/** Applies a buy/sell/income/corporate-action using the average-cost method. */
export async function recordInvestmentTransaction(userId: string, investmentId: string, input: InvTxnInput, conn?: Knex.Transaction) {
  const run = async (trx: Knex.Transaction) => {
    const inv = await trx('investments').where({ id: investmentId, user_id: userId }).forUpdate().first();
    if (!inv) throw notFound('Investment');
    if (inv.status !== 'active') throw conflict('This holding is closed');
    const units = dec(input.units ?? 0);
    const price = dec(input.price ?? 0);
    const fees = dec(input.fees ?? 0);
    const holdingUnits = dec(inv.units);
    const invested = dec(inv.investedAmount);
    let gross = input.amount != null ? dec(input.amount) : units.times(price);
    let realized: InstanceType<typeof D> | null = null;
    const patch: Record<string, unknown> = {};
    let cashAmount = gross;

    switch (input.type) {
      case 'buy': {
        if (gross.lte(0)) throw unprocessable('A purchase needs an amount, or units and price');
        if (!DEPOSIT_TYPES.has(inv.instrumentType) && units.lte(0)) throw unprocessable('Enter the number of units bought', { field: 'units' });
        patch.units = holdingUnits.plus(units).toFixed(8);
        patch.invested_amount = storage(invested.plus(gross).plus(fees));
        cashAmount = gross.plus(fees);
        if (price.gt(0) && inv.priceSource !== 'live' && inv.priceSource !== 'delayed') {
          Object.assign(patch, { current_price: price.toFixed(6), price_source: 'manual', price_as_of: new Date(`${input.tradeDate}T00:00:00Z`) });
        }
        break;
      }
      case 'sell': {
        if (DEPOSIT_TYPES.has(inv.instrumentType)) {
          // Deposits are redeemed by amount; the whole cost basis is released on full redemption.
          if (gross.lte(0)) throw unprocessable('Enter the redemption amount');
          const cost = invested;
          realized = gross.minus(fees).minus(cost);
          Object.assign(patch, { units: '0', invested_amount: '0', status: 'matured' });
        } else {
          if (units.lte(0) || units.gt(holdingUnits)) throw unprocessable(`You can sell at most ${holdingUnits.toString()} units`, { field: 'units' });
          if (gross.lte(0)) gross = units.times(price);
          const avgCost = invested.div(holdingUnits);
          const cost = avgCost.times(units);
          realized = gross.minus(fees).minus(cost);
          const remaining = holdingUnits.minus(units);
          Object.assign(patch, { units: remaining.toFixed(8), invested_amount: storage(remaining.isZero() ? 0 : invested.minus(cost)) });
          if (remaining.isZero()) patch.status = 'closed';
        }
        patch.realized_gain = storage(dec(inv.realizedGain).plus(realized));
        cashAmount = gross.minus(fees);
        break;
      }
      case 'dividend':
      case 'interest':
        if (gross.lte(0)) throw unprocessable('Enter the amount received');
        patch.realized_gain = storage(dec(inv.realizedGain).plus(gross));
        realized = gross;
        break;
      case 'bonus':
      case 'split':
        if (units.lte(0)) throw unprocessable('Enter the additional units received');
        patch.units = holdingUnits.plus(units).toFixed(8);
        gross = new D(0);
        cashAmount = new D(0);
        break;
      case 'fee':
        if (gross.lte(0)) throw unprocessable('Enter the fee amount');
        patch.invested_amount = storage(invested.plus(gross));
        break;
    }

    const ledger = cashAmount.gt(0) ? await ledgerFor(userId, inv, input, storage(cashAmount), trx) : null;
    if (Object.keys(patch).length) await trx('investments').where({ id: investmentId }).update(patch);
    const [row] = await trx('investment_transactions')
      .insert({
        user_id: userId,
        investment_id: investmentId,
        type: input.type,
        trade_date: input.tradeDate,
        units: units.toFixed(8),
        price: price.toFixed(6),
        amount: storage(gross),
        fees: storage(fees),
        realized_gain: realized ? storage(realized) : null,
        cash_account_id: input.cashAccountId ?? null,
        transaction_id: ledger?.id ?? null,
        notes: input.notes ?? null,
      })
      .returning('*');
    return row;
  };
  return conn ? run(conn) : withTransaction(run);
}

function cashflowsFor(txns: Array<Record<string, any>>): CashFlow[] {
  return txns
    .filter((t) => ['buy', 'sell', 'dividend', 'interest', 'fee'].includes(t.type))
    .map((t) => {
      const amount = dec(t.amount);
      const fees = dec(t.fees);
      if (t.type === 'buy') return { date: t.tradeDate, amount: amount.plus(fees).neg().toString() };
      if (t.type === 'fee') return { date: t.tradeDate, amount: amount.neg().toString() };
      return { date: t.tradeDate, amount: amount.minus(t.type === 'sell' ? fees : 0).toString() };
    });
}

export async function investmentDetails(userId: string, id: string) {
  const inv = await db('investments').where({ id, user_id: userId }).first();
  if (!inv) throw notFound('Investment');
  const txns = await db('investment_transactions').where({ investment_id: id }).orderBy([{ column: 'trade_date' }, { column: 'created_at' }]);
  const decorated = decorateInvestment(inv);
  const flows = cashflowsFor(txns);
  if (dec(decorated.currentValue).gt(0) && inv.status === 'active') flows.push({ date: todayIn(), amount: decorated.currentValue });
  const income = sum(txns.filter((t: any) => t.type === 'dividend' || t.type === 'interest').map((t: any) => t.amount));
  return {
    ...decorated,
    incomeReceived: money(income),
    xirrPercent: flows.length >= 2 ? (xirr(flows.sort((a, b) => a.date.localeCompare(b.date)))?.toFixed(2) ?? null) : null,
    transactions: txns.map((t: any) => ({ ...t, amount: money(t.amount), fees: money(t.fees), realizedGain: t.realizedGain != null ? money(t.realizedGain) : null })),
  };
}

/** Portfolio totals, allocation, performance and data-source disclosure. */
export async function portfolio(userId: string) {
  const holdings: Array<Record<string, any>> = await db('investments').where({ user_id: userId }).orderBy('name');
  const txns: Array<Record<string, any>> = await db('investment_transactions').where({ user_id: userId }).orderBy('trade_date');
  const active = holdings.filter((h) => h.status === 'active').map(decorateInvestment);
  const invested = sum(active.map((h) => h.investedAmount));
  const current = sum(active.map((h) => h.currentValue));
  const realized = sum(holdings.map((h) => h.realizedGain));
  const flows = cashflowsFor(txns);
  if (current.gt(0)) flows.push({ date: todayIn(), amount: current.toString() });

  const allocation = new Map<string, InstanceType<typeof D>>();
  const risk = new Map<string, InstanceType<typeof D>>();
  const sources = new Map<string, number>();
  for (const h of active) {
    allocation.set(h.instrumentType, (allocation.get(h.instrumentType) ?? new D(0)).plus(h.currentValue));
    risk.set(h.riskLevel ?? 'unspecified', (risk.get(h.riskLevel ?? 'unspecified') ?? new D(0)).plus(h.currentValue));
    sources.set(h.valuationSource, (sources.get(h.valuationSource) ?? 0) + 1);
  }
  const ranked = [...active].filter((h) => h.unrealizedGainPercent != null).sort((a, b) => Number(b.unrealizedGainPercent) - Number(a.unrealizedGainPercent));

  // Invested amount by month (cost basis flow) for the performance chart.
  const monthly = new Map<string, InstanceType<typeof D>>();
  for (const t of txns) {
    const m = String(t.tradeDate).slice(0, 7);
    const delta = t.type === 'buy' ? dec(t.amount).plus(t.fees) : t.type === 'sell' ? dec(t.amount).neg() : new D(0);
    monthly.set(m, (monthly.get(m) ?? new D(0)).plus(delta));
  }
  let running = new D(0);
  const investedHistory = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, delta]) => {
    running = running.plus(delta);
    return { month, netInvested: money(running) };
  });

  return {
    totals: {
      holdings: active.length,
      invested: money(invested),
      currentValue: money(current),
      unrealizedGain: money(current.minus(invested)),
      unrealizedGainPercent: absoluteReturn(invested, current)?.toFixed(2) ?? null,
      realizedGain: money(realized),
      xirrPercent: flows.length >= 2 ? (xirr(flows.sort((a, b) => a.date.localeCompare(b.date)))?.toFixed(2) ?? null) : null,
    },
    allocation: [...allocation.entries()].map(([instrumentType, value]) => ({ instrumentType, value: money(value), percent: percent(value, current) })).sort((a, b) => Number(b.percent) - Number(a.percent)),
    riskAllocation: [...risk.entries()].map(([riskLevel, value]) => ({ riskLevel, value: money(value), percent: percent(value, current) })),
    topGainers: ranked.slice(0, 3).map((h) => ({ id: h.id, name: h.name, gainPercent: h.unrealizedGainPercent })),
    topLosers: ranked.slice(-3).reverse().filter((h) => Number(h.unrealizedGainPercent) < 0).map((h) => ({ id: h.id, name: h.name, gainPercent: h.unrealizedGainPercent })),
    investedHistory,
    dataSources: [...sources.entries()].map(([source, count]) => ({ source, label: source === 'cost_basis' ? 'No price (cost basis)' : PRICE_SOURCE_LABEL[source], count })),
    disclaimer: 'Values marked manual, calculated or cost basis are not live market prices. Past returns do not guarantee future performance.',
    holdingsList: active,
  };
}
