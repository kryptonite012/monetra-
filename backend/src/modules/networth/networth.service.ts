import { db } from '../../db/knex';
import { netWorth } from '../../engine';
import { todayIn } from '../../lib/dates';
import { D, dec, money, storage, sum } from '../../lib/money';
import { listAccounts } from '../accounts/accounts.service';
import { decorateInvestment } from '../investments/investments.service';
import { listLoans } from '../loans/loans.service';

/**
 * Net worth = everything owned minus everything owed, built only from the
 * user's own records (see docs/CALCULATIONS.md for the exact rules).
 */
export async function computeNetWorth(userId: string) {
  const accounts = (await listAccounts(userId)).filter((a) => a.includeInNetWorth);
  const investments = (await db('investments').where({ user_id: userId, status: 'active' })).map(decorateInvestment);
  const assets: Array<Record<string, any>> = await db('assets').where({ user_id: userId, include_in_net_worth: true }).whereNull('disposed_on');
  const loans = await listLoans(userId);
  const liabilities: Array<Record<string, any>> = await db('liabilities').where({ user_id: userId, status: 'open' });

  const cashAndBank = sum(accounts.filter((a) => dec(a.balance).gt(0)).map((a) => a.balance));
  const negativeAccounts = sum(accounts.filter((a) => dec(a.balance).lt(0)).map((a) => dec(a.balance).abs()));
  const investmentValue = sum(investments.map((i) => i.currentValue));
  const physical = sum(assets.map((a) => a.currentValue));
  const loanOutstanding = sum(loans.map((l: any) => l.outstandingPrincipal));
  const otherLiabilities = sum(liabilities.map((l) => l.amountOutstanding));

  const totalAssets = cashAndBank.plus(investmentValue).plus(physical);
  const totalLiabilities = negativeAccounts.plus(loanOutstanding).plus(otherLiabilities);

  const assetsByType = new Map<string, InstanceType<typeof D>>();
  for (const a of assets) assetsByType.set(a.assetType, (assetsByType.get(a.assetType) ?? new D(0)).plus(a.currentValue));

  return {
    asOf: todayIn(),
    totalAssets: money(totalAssets),
    totalLiabilities: money(totalLiabilities),
    netWorth: money(netWorth(totalAssets, totalLiabilities)),
    assets: {
      cashAndBank: money(cashAndBank),
      investments: money(investmentValue),
      physicalAssets: money(physical),
      physicalByType: [...assetsByType.entries()].map(([type, value]) => ({ type, value: money(value) })),
    },
    liabilities: {
      creditCardsAndOverdrafts: money(negativeAccounts),
      loans: money(loanOutstanding),
      other: money(otherLiabilities),
    },
    composition: [
      { key: 'cash_bank', label: 'Cash & bank', value: money(cashAndBank), side: 'asset' },
      { key: 'investments', label: 'Investments', value: money(investmentValue), side: 'asset' },
      { key: 'physical', label: 'Property & other assets', value: money(physical), side: 'asset' },
      { key: 'cards', label: 'Credit cards', value: money(negativeAccounts), side: 'liability' },
      { key: 'loans', label: 'Loans', value: money(loanOutstanding), side: 'liability' },
      { key: 'other_liabilities', label: 'Other liabilities', value: money(otherLiabilities), side: 'liability' },
    ],
    valuationNote: 'Includes manual, calculated and delayed valuations as labelled on each holding; not a certified valuation.',
  };
}

/** Stores (or refreshes) today's net-worth snapshot for trend charts. */
export async function snapshotNetWorth(userId: string, date = todayIn()) {
  const nw = await computeNetWorth(userId);
  const [row] = await db('net_worth_snapshots')
    .insert({
      user_id: userId,
      snapshot_date: date,
      total_assets: storage(nw.totalAssets),
      total_liabilities: storage(nw.totalLiabilities),
      net_worth: storage(nw.netWorth),
      breakdown: JSON.stringify({ assets: nw.assets, liabilities: nw.liabilities }),
    })
    .onConflict(['user_id', 'snapshot_date'])
    .merge()
    .returning('*');
  return row;
}

export async function netWorthHistory(userId: string, months: number) {
  const rows = await db('net_worth_snapshots')
    .where({ user_id: userId })
    .where('snapshot_date', '>=', db.raw(`CURRENT_DATE - (? || ' months')::interval`, [months]))
    .orderBy('snapshot_date')
    .select('snapshot_date', 'total_assets', 'total_liabilities', 'net_worth');
  // Keep the last snapshot of each month plus today's live figure.
  const byMonth = new Map<string, Record<string, any>>();
  for (const r of rows) byMonth.set(String(r.snapshotDate).slice(0, 7), r);
  const current = await computeNetWorth(userId);
  byMonth.set(current.asOf.slice(0, 7), { snapshotDate: current.asOf, totalAssets: current.totalAssets, totalLiabilities: current.totalLiabilities, netWorth: current.netWorth });
  const points = [...byMonth.values()].map((r) => ({ date: r.snapshotDate, month: String(r.snapshotDate).slice(0, 7), totalAssets: money(r.totalAssets), totalLiabilities: money(r.totalLiabilities), netWorth: money(r.netWorth) }));
  const first = points[0];
  const last = points.at(-1)!;
  return { points, change: first ? money(dec(last.netWorth).minus(first.netWorth)) : '0.00' };
}
