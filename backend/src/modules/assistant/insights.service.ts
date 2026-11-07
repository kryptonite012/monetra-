import { db } from '../../db/knex';
import { linearForecast, monthsToTarget, projectBalance } from '../../engine';
import { addDays, addMonths, monthEnd, monthStart, todayIn } from '../../lib/dates';
import { dec, formatINR, money, percent, sum } from '../../lib/money';
import { accountsSummary } from '../accounts/accounts.service';
import { budgetUtilization } from '../budgets/budgets.service';
import { subscriptionSummary } from '../bills/bills.service';
import { cashflowSeries, categoryBreakdown, flowTotals } from '../dashboard/dashboard.service';
import { detectAnomalies } from './anomaly';

export type Severity = 'info' | 'positive' | 'warning' | 'critical';

export interface Insight {
  id: string;
  type: 'spending_change' | 'top_category' | 'anomaly' | 'unused_subscription' | 'recurring_charge' | 'budget_overrun' | 'forecast' | 'savings_rate';
  severity: Severity;
  title: string;
  detail: string;
  assumptions?: string[];
  data?: Record<string, unknown>;
}

export const FORECAST_DISCLAIMER =
  'Forecasts are statistical estimates based on your past records. They are not guarantees, and actual results will differ with your future income and spending.';

/** Expense forecast from the trend of the last six complete months. */
export async function expenditureForecast(userId: string, ahead = 3) {
  const series = (await cashflowSeries(userId, 7)).slice(0, -1); // complete months only
  const values = series.map((s) => s.expenses);
  const nonZero = values.filter((v) => dec(v).gt(0)).length;
  const fit = linearForecast(values, ahead);
  const start = todayIn();
  return {
    history: series.map((s) => ({ month: s.month, expenses: s.expenses })),
    forecast: fit.forecasts.map((f, i) => ({ month: addMonths(monthStart(start), i).slice(0, 7), ...f })),
    method: 'Least-squares trend over the last 6 complete months with a ~90% range (±1.645 × residual standard error).',
    confidence: nonZero >= 5 ? 'medium' : nonZero >= 3 ? 'low' : 'very low',
    dataPoints: nonZero,
  };
}

/** Savings projection: liquid balance plus the average monthly surplus of the last 3 months. */
export async function savingsForecast(userId: string, months = 6, annualReturnPct = 0) {
  const today = todayIn();
  const from = monthStart(addMonths(today, -3));
  const to = addDays(monthStart(today), -1);
  const flows = await flowTotals(userId, from, to);
  const avgNet = flows.income.minus(flows.expenses).div(3);
  const accounts = await accountsSummary(userId);
  return {
    startingBalance: accounts.totalAvailableBalance,
    averageMonthlySurplus: money(avgNet),
    annualReturnAssumed: String(annualReturnPct),
    projection: projectBalance({ startBalance: accounts.totalAvailableBalance, monthlyContribution: avgNet, annualReturnPct, months, startDate: today }),
    assumptions: [
      `Your average monthly surplus over the last 3 complete months (${formatINR(avgNet)}) continues unchanged.`,
      `Starting from your current bank, cash and wallet balance of ${formatINR(accounts.totalAvailableBalance)}.`,
      annualReturnPct > 0 ? `Savings earn ${annualReturnPct}% a year, compounded monthly.` : 'No interest or investment returns are assumed.',
      'One-off events (bonuses, large purchases, job changes) are not modelled.',
    ],
    disclaimer: FORECAST_DISCLAIMER,
  };
}

/** Merchants charged in at least 3 of the last 4 months with similar amounts but not tracked as subscriptions/bills. */
async function untrackedRecurringCharges(userId: string) {
  const from = monthStart(addMonths(todayIn(), -3));
  const rows: Array<Record<string, any>> = await db('transactions as t')
    .join('merchants as m', 'm.id', 't.merchant_id')
    .where('t.user_id', userId)
    .where('t.status', 'posted')
    .whereIn('t.kind', ['expense'])
    .where('t.occurred_on', '>=', from)
    .groupBy('m.id', 'm.name')
    .havingRaw(`COUNT(DISTINCT date_trunc('month', t.occurred_on)) >= 3`)
    .havingRaw('STDDEV_POP(t.amount) <= 0.15 * AVG(t.amount)')
    .select('m.id', 'm.name', db.raw('AVG(t.amount) AS average'), db.raw('COUNT(*)::int AS occurrences'));
  const tracked = new Set(
    [
      ...(await db('subscriptions').where({ user_id: userId }).whereNot({ status: 'cancelled' }).pluck('name')),
      ...(await db('bills').where({ user_id: userId }).whereNot({ status: 'cancelled' }).pluck('name')),
    ].map((n: string) => n.toLowerCase()),
  );
  return rows.filter((r) => ![...tracked].some((t) => r.name.toLowerCase().includes(t) || t.includes(r.name.toLowerCase())));
}

export async function generateInsights(userId: string): Promise<Insight[]> {
  const today = todayIn();
  const thisFrom = monthStart(today);
  const lastFrom = monthStart(addMonths(today, -1));
  const lastTo = monthEnd(lastFrom);
  // Compare month-to-date with the same number of days last month for fairness.
  const dayOfMonth = Number(today.slice(8, 10));
  const lastComparableTo = addDays(lastFrom, Math.min(dayOfMonth, Number(lastTo.slice(8, 10))) - 1);
  const insights: Insight[] = [];

  const [thisCats, lastCats, thisFlow, lastFlow] = await Promise.all([
    categoryBreakdown(userId, thisFrom, today),
    categoryBreakdown(userId, lastFrom, lastComparableTo),
    flowTotals(userId, thisFrom, today),
    flowTotals(userId, lastFrom, lastComparableTo),
  ]);

  if (lastFlow.expenses.gt(0) && thisFlow.expenses.gt(0)) {
    const change = thisFlow.expenses.minus(lastFlow.expenses).div(lastFlow.expenses).times(100);
    if (change.abs().gte(10)) {
      insights.push({
        id: 'spending-change',
        type: 'spending_change',
        severity: change.gt(0) ? 'warning' : 'positive',
        title: `Spending is ${change.gt(0) ? 'up' : 'down'} ${change.abs().toFixed(0)}% vs last month`,
        detail: `You have spent ${formatINR(thisFlow.expenses)} in the first ${dayOfMonth} days of this month, compared with ${formatINR(lastFlow.expenses)} over the same days last month.`,
        data: { thisPeriod: money(thisFlow.expenses), lastPeriod: money(lastFlow.expenses), changePercent: change.toFixed(2) },
      });
    }
    const increases = thisCats
      .map((c) => ({ ...c, before: lastCats.find((l) => l.name === c.name)?.total ?? '0' }))
      .map((c) => ({ ...c, delta: dec(c.total).minus(c.before) }))
      .filter((c) => c.delta.gt(1000))
      .sort((a, b) => b.delta.cmp(a.delta));
    if (increases[0]) {
      insights.push({
        id: `category-increase-${increases[0].name}`,
        type: 'spending_change',
        severity: 'info',
        title: `${increases[0].name} spending rose by ${formatINR(increases[0].delta)}`,
        detail: `${increases[0].name} is your biggest increase this month: ${formatINR(increases[0].total)} so far vs ${formatINR(increases[0].before)} by this point last month.`,
      });
    }
  }

  if (thisCats[0]) {
    const share = thisFlow.income.gt(0) ? percent(thisCats[0].total, thisFlow.income) : null;
    insights.push({
      id: 'top-category',
      type: 'top_category',
      severity: share && Number(share) > 40 ? 'warning' : 'info',
      title: `${thisCats[0].name} is your largest expense category`,
      detail: `${thisCats[0].name} accounts for ${thisCats[0].percent}% of this month's spending (${formatINR(thisCats[0].total)})${share ? ` and ${share}% of this month's income` : ''}.`,
    });
  }

  const savingsRate = thisFlow.income.gt(0) ? thisFlow.income.minus(thisFlow.expenses).div(thisFlow.income).times(100) : null;
  if (savingsRate) {
    insights.push({
      id: 'savings-rate',
      type: 'savings_rate',
      severity: savingsRate.gte(20) ? 'positive' : savingsRate.gte(0) ? 'info' : 'critical',
      title: `You're saving ${savingsRate.toFixed(0)}% of your income this month`,
      detail: savingsRate.gte(20)
        ? 'That is at or above the commonly recommended 20% savings rate.'
        : savingsRate.gte(0)
          ? 'Aiming for 20% builds a cushion faster; review your top categories for room to trim.'
          : 'You are spending more than you earn this month. Check for one-off expenses and upcoming income.',
    });
  }

  for (const a of (await detectAnomalies(userId, addDays(today, -30), today)).slice(0, 3)) {
    insights.push({ id: `anomaly-${a.transactionId}`, type: 'anomaly', severity: 'warning', title: `Unusual expense: ${formatINR(a.amount)}`, detail: `"${a.description}" on ${a.occurredOn} is ${a.reason}.`, data: a as unknown as Record<string, unknown> });
  }

  const subs = await subscriptionSummary(userId);
  for (const s of subs.possiblyUnused) {
    insights.push({ id: `unused-${s.id}`, type: 'unused_subscription', severity: 'info', title: `Do you still use ${s.name}?`, detail: `${s.reason}. Cancelling would save about ${formatINR(s.monthlyCost)} a month.` });
  }
  for (const c of await untrackedRecurringCharges(userId)) {
    insights.push({
      id: `recurring-${c.id}`,
      type: 'recurring_charge',
      severity: 'info',
      title: `Recurring charge detected: ${c.name}`,
      detail: `${c.name} has charged you about ${formatINR(c.average)} in ${c.occurrences} of the last 4 months. Add it as a subscription to track renewals, or cancel it if it's unnecessary.`,
    });
  }

  const budget = await db('budgets').where({ user_id: userId, month: thisFrom }).first('id');
  if (budget) {
    const report = await budgetUtilization(userId, budget.id);
    for (const c of report.categories.filter((x) => x.status === 'exceeded' || dec(x.projectedOverrun).gt(0))) {
      insights.push({
        id: `budget-${c.categoryId}`,
        type: 'budget_overrun',
        severity: c.status === 'exceeded' ? 'critical' : 'warning',
        title: c.status === 'exceeded' ? `${c.name} is over budget` : `${c.name} is on track to exceed its budget`,
        detail:
          c.status === 'exceeded'
            ? `Spent ${formatINR(c.spent)} of ${formatINR(c.limit)}.`
            : `At the current pace you'll spend about ${formatINR(c.projectedSpend)} against a ${formatINR(c.limit)} limit.`,
        assumptions: c.status === 'exceeded' ? undefined : ['Projection assumes you keep spending at this month’s daily average.'],
      });
    }
  }

  const forecast = await expenditureForecast(userId, 1);
  if (forecast.dataPoints >= 3 && forecast.forecast[0]) {
    const f = forecast.forecast[0];
    insights.push({
      id: 'expense-forecast',
      type: 'forecast',
      severity: 'info',
      title: `Next month's spending is likely around ${formatINR(f.value)}`,
      detail: `Based on your last ${forecast.dataPoints} months, a likely range is ${formatINR(f.low)} – ${formatINR(f.high)}.`,
      assumptions: [forecast.method, FORECAST_DISCLAIMER],
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, positive: 2, info: 3 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Months of surplus needed to fund an amount (used by affordability answers). */
export function monthsOfSurplus(amount: string, monthlySurplus: string): number | null {
  return monthsToTarget(amount, 0, monthlySurplus);
}

export { sum };
