import { db } from '../../db/knex';
import { creditUtilization, debtToIncome, financialHealthScore, savingsRate } from '../../engine';
import { addDays, addMonths, monthEnd, monthStart, todayIn } from '../../lib/dates';
import { dec, money, percent, sum } from '../../lib/money';
import { accountsSummary, listAccounts } from '../accounts/accounts.service';
import { budgetUtilization } from '../budgets/budgets.service';
import { upcomingPayments } from '../bills/bills.service';
import { listGoals } from '../goals/goals.service';
import { liabilitySummary } from '../loans/loans.service';
import { computeNetWorth } from '../networth/networth.service';
import { serializeTransaction } from '../transactions/ledger.service';

export const INCOME_KINDS = ['income', 'interest'];
export const SPEND_KINDS = ['expense', 'bill_payment', 'fee', 'loan_repayment'];

export function periodRange(period: 'month' | 'quarter' | 'year', today = todayIn()) {
  if (period === 'month') return { from: monthStart(today), to: monthEnd(today) };
  if (period === 'quarter') {
    const m = Number(today.slice(5, 7));
    const qStart = `${today.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    return { from: qStart, to: monthEnd(addMonths(qStart, 2)) };
  }
  return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
}

/** Income and spending totals for a date range. */
export async function flowTotals(userId: string, from: string, to: string) {
  const [row] = await db('transactions')
    .where({ user_id: userId, status: 'posted' })
    .whereBetween('occurred_on', [from, to])
    .select(
      db.raw(`COALESCE(SUM(amount) FILTER (WHERE kind IN ('income','interest')), 0) AS income`),
      db.raw(`COALESCE(SUM(amount) FILTER (WHERE kind IN ('expense','bill_payment','fee','loan_repayment')), 0) AS expenses`),
    );
  return { income: dec(row.income), expenses: dec(row.expenses) };
}

/** Monthly income / expense / net series for the last N months (including the current one). */
export async function cashflowSeries(userId: string, months: number) {
  const start = monthStart(addMonths(todayIn(), -(months - 1)));
  const { rows } = await db.raw(
    `SELECT to_char(m.month, 'YYYY-MM') AS month,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind IN ('income','interest')), 0) AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind IN ('expense','bill_payment','fee','loan_repayment')), 0) AS expenses
       FROM generate_series(?::date, date_trunc('month', CURRENT_DATE), interval '1 month') AS m(month)
       LEFT JOIN transactions t
         ON t.user_id = ? AND t.status = 'posted' AND date_trunc('month', t.occurred_on) = m.month
      GROUP BY m.month ORDER BY m.month`,
    [start, userId],
  );
  return rows.map((r: Record<string, string>) => ({ month: r.month, income: money(r.income), expenses: money(r.expenses), net: money(dec(r.income).minus(r.expenses)) }));
}

export async function categoryBreakdown(userId: string, from: string, to: string) {
  const rows = await db('transactions as t')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .leftJoin('transaction_categories as pc', 'pc.id', 'c.parent_id')
    .where('t.user_id', userId)
    .where('t.status', 'posted')
    .whereIn('t.kind', SPEND_KINDS)
    .whereBetween('t.occurred_on', [from, to])
    .groupByRaw('1, 2, 3')
    .select(db.raw('COALESCE(pc.id, c.id) AS category_id'), db.raw(`COALESCE(pc.name, c.name, 'Uncategorised') AS name`), db.raw('COALESCE(pc.color, c.color) AS color'), db.raw('SUM(t.amount) AS total'))
    .orderBy('total', 'desc');
  const total = sum(rows.map((r: any) => r.total));
  return rows.map((r: any) => ({ ...r, total: money(r.total), percent: percent(r.total, total) }));
}

/** Health score inputs use 3-month averages to smooth out one-off months. */
export async function healthScore(userId: string) {
  const today = todayIn();
  const from = monthStart(addMonths(today, -2));
  const flows = await flowTotals(userId, from, today);
  const monthlyIncome = flows.income.div(3);
  const monthlyExpenses = flows.expenses.div(3);
  const accounts = await accountsSummary(userId);
  const liabilities = await liabilitySummary(userId);
  const nw = await computeNetWorth(userId);
  const cards = (await listAccounts(userId)).filter((a) => a.type === 'credit_card' && a.creditLimit != null);
  const util = creditUtilization(sum(cards.map((c) => c.outstanding)), sum(cards.map((c) => c.creditLimit)));
  const budget = await db('budgets').where({ user_id: userId, month: monthStart(today) }).first('id');
  let adherence: number | null = null;
  if (budget) {
    const report = await budgetUtilization(userId, budget.id);
    if (report.categories.length) adherence = (report.categories.filter((c) => c.status !== 'exceeded').length / report.categories.length) * 100;
  }
  return financialHealthScore({
    monthlyIncome,
    monthlyExpenses,
    liquidAssets: accounts.totalAvailableBalance,
    monthlyDebtPayments: liabilities.loans.monthlyEmi,
    netWorth: nw.netWorth,
    budgetAdherencePct: adherence,
    creditUtilizationPct: util && dec(sum(cards.map((c) => c.outstanding))).gt(0) ? util.toNumber() : null,
  });
}

export async function dashboard(userId: string, period: 'month' | 'quarter' | 'year') {
  const range = periodRange(period);
  const [accounts, flows, nw, liabilities, upcoming, recentRows, series, categories, goals, health] = await Promise.all([
    accountsSummary(userId),
    flowTotals(userId, range.from, range.to),
    computeNetWorth(userId),
    liabilitySummary(userId),
    upcomingPayments(userId, 14),
    db('transactions as t')
      .join('accounts as a', 'a.id', 't.account_id')
      .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
      .where('t.user_id', userId)
      .where('t.status', 'posted')
      .whereNot('t.kind', 'reversal')
      .orderBy([{ column: 't.occurred_on', order: 'desc' }, { column: 't.posted_at', order: 'desc' }])
      .limit(8)
      .select('t.*', 'a.name as account_name', 'c.name as category_name', 'c.color as category_color', 'c.icon as category_icon'),
    cashflowSeries(userId, period === 'year' ? 12 : 6),
    categoryBreakdown(userId, range.from, range.to),
    listGoals(userId, 'active'),
    healthScore(userId),
  ]);
  const lastSnapshot = await db('net_worth_snapshots').where({ user_id: userId }).where('snapshot_date', '<', addDays(todayIn(), -25)).orderBy('snapshot_date', 'desc').first('net_worth', 'snapshot_date');
  const dti = debtToIncome(liabilities.loans.monthlyEmi, flows.income.div(period === 'month' ? 1 : period === 'quarter' ? 3 : 12));
  return {
    period: { type: period, ...range },
    balances: { totalAvailableBalance: accounts.totalAvailableBalance, creditCardOutstanding: accounts.creditCardOutstanding, accountCount: accounts.accountCount },
    totals: {
      income: money(flows.income),
      expenses: money(flows.expenses),
      netCashFlow: money(flows.income.minus(flows.expenses)),
      savingsRatePercent: savingsRate(flows.income, flows.expenses)?.toFixed(2) ?? null,
      debtToIncomePercent: dti?.toFixed(2) ?? null,
    },
    netWorth: {
      value: nw.netWorth,
      totalAssets: nw.totalAssets,
      totalLiabilities: nw.totalLiabilities,
      changeSinceLastMonth: lastSnapshot ? money(dec(nw.netWorth).minus(lastSnapshot.netWorth)) : null,
    },
    liabilities: { totalOutstanding: liabilities.totalOutstanding, loanOutstanding: liabilities.loans.outstanding, monthlyEmi: liabilities.loans.monthlyEmi, nextEmis: liabilities.upcomingEmis.slice(0, 3) },
    upcomingBills: upcoming.items.slice(0, 6),
    recentTransactions: recentRows.map(serializeTransaction),
    charts: { cashflow: series, spendingByCategory: categories },
    goals: goals.slice(0, 3).map((g: any) => ({ id: g.id, name: g.name, completionPercent: g.completionPercent, savedAmount: g.savedAmount, targetAmount: g.targetAmount, estimatedCompletionDate: g.estimatedCompletionDate })),
    healthScore: health,
  };
}
