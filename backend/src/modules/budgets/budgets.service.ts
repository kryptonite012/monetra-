import { db, type Db } from '../../db/knex';
import { daysBetween, monthEnd, todayIn } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { dec, max, money, percent, sum } from '../../lib/money';

const SPEND_KINDS = ['expense', 'bill_payment', 'fee', 'loan_repayment'];

export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

export interface CategoryUtilization {
  id: string;
  categoryId: string;
  name: string;
  color: string | null;
  icon: string | null;
  limit: string;
  spent: string;
  remaining: string;
  utilizationPercent: string;
  alertThresholdPct: number;
  status: BudgetStatus;
  projectedSpend: string;
  projectedOverrun: string;
  dailyAllowance: string;
}

export interface BudgetReport extends Record<string, any> {
  id: string;
  month: string;
  totals: Record<string, any> & { limit: string; spent: string; utilizationPercent: string; status: BudgetStatus; income: string; actualSavings: string; savingsTarget: string | null };
  categories: CategoryUtilization[];
  alerts: Array<{ categoryId: string; name: string; status: BudgetStatus; message: string }>;
}

/** Spend per category (with the parent roll-up) for a month. */
async function spendByCategory(userId: string, from: string, to: string, conn: Db) {
  const rows: Array<{ categoryId: string | null; parentId: string | null; total: string }> = await conn('transactions as t')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .where('t.user_id', userId)
    .whereIn('t.kind', SPEND_KINDS)
    .where('t.status', 'posted')
    .whereBetween('t.occurred_on', [from, to])
    .groupBy('t.category_id', 'c.parent_id')
    .select('t.category_id', 'c.parent_id', conn.raw('SUM(t.amount) AS total'));
  return rows;
}

/**
 * Budget utilisation for a month. A budgeted category includes spending in
 * its sub-categories. For the running month a linear month-end projection is
 * provided; it is an estimate, not a guarantee.
 */
export async function budgetUtilization(userId: string, budgetId: string, conn: Db = db): Promise<BudgetReport> {
  const budget = await conn('budgets').where({ id: budgetId, user_id: userId }).first();
  if (!budget) throw notFound('Budget');
  const from: string = budget.month;
  const to = monthEnd(from);
  const today = todayIn();
  const totalDays = daysBetween(from, to) + 1;
  const elapsed = today < from ? 0 : today > to ? totalDays : daysBetween(from, today) + 1;
  const isCurrent = today >= from && today <= to;

  const lines: Array<Record<string, any>> = await conn('budget_categories as b')
    .join('transaction_categories as c', 'c.id', 'b.category_id')
    .where('b.budget_id', budgetId)
    .select('b.id', 'b.category_id', 'b.limit_amount', 'b.alert_threshold_pct', 'c.name', 'c.color', 'c.icon', 'c.parent_id')
    .orderBy('c.name');
  const spend = await spendByCategory(userId, from, to, conn);
  const totalSpent = sum(spend.map((s) => s.total));

  const budgetedIds = new Set(lines.map((l) => l.categoryId));
  const categories: CategoryUtilization[] = lines.map((line) => {
    const spent = sum(spend.filter((s) => s.categoryId === line.categoryId || s.parentId === line.categoryId).map((s) => s.total));
    const limit = dec(line.limitAmount);
    const utilization = limit.isZero() ? dec(0) : spent.div(limit).times(100);
    const status: BudgetStatus = utilization.gte(100) ? (utilization.gt(100) ? 'exceeded' : 'warning') : utilization.gte(line.alertThresholdPct) ? 'warning' : 'ok';
    const projected = isCurrent && elapsed > 0 ? spent.div(elapsed).times(totalDays) : spent;
    const remaining = limit.minus(spent);
    const daysLeft = isCurrent ? totalDays - elapsed + 1 : 0;
    return {
      id: line.id,
      categoryId: line.categoryId,
      name: line.name,
      color: line.color,
      icon: line.icon,
      limit: money(limit),
      spent: money(spent),
      remaining: money(remaining),
      utilizationPercent: utilization.toDecimalPlaces(2).toFixed(2),
      alertThresholdPct: line.alertThresholdPct,
      status,
      projectedSpend: money(projected),
      projectedOverrun: projected.gt(limit) ? money(projected.minus(limit)) : '0.00',
      dailyAllowance: daysLeft > 0 && remaining.gt(0) ? money(remaining.div(daysLeft)) : '0.00',
    };
  });

  // Spending in categories that have no budget line (neither directly nor via the parent).
  const unbudgeted = sum(spend.filter((s) => !budgetedIds.has(s.categoryId ?? '') && !budgetedIds.has(s.parentId ?? '')).map((s) => s.total));

  const [income] = await conn('transactions')
    .where({ user_id: userId, status: 'posted' })
    .whereIn('kind', ['income', 'interest'])
    .whereBetween('occurred_on', [from, to])
    .select(conn.raw('COALESCE(SUM(amount), 0) AS total'));
  const actualSavings = dec(income.total).minus(totalSpent);
  const limitTotal = budget.totalLimit != null ? dec(budget.totalLimit) : sum(lines.map((l) => l.limitAmount));
  const overallUtil = limitTotal.isZero() ? dec(0) : totalSpent.div(limitTotal).times(100);

  return {
    ...budget,
    month: from.slice(0, 7),
    period: { from, to, daysElapsed: elapsed, totalDays, isCurrent },
    totals: {
      limit: money(limitTotal),
      spent: money(totalSpent),
      remaining: money(limitTotal.minus(totalSpent)),
      utilizationPercent: overallUtil.toDecimalPlaces(2).toFixed(2),
      status: (overallUtil.gt(100) ? 'exceeded' : overallUtil.gte(80) ? 'warning' : 'ok') as BudgetStatus,
      unbudgetedSpend: money(unbudgeted),
      projectedSpend: money(isCurrent && elapsed > 0 ? totalSpent.div(elapsed).times(totalDays) : totalSpent),
      income: money(income.total),
      savingsTarget: budget.savingsTarget != null ? money(budget.savingsTarget) : null,
      actualSavings: money(actualSavings),
      savingsTargetMet: budget.savingsTarget != null ? actualSavings.gte(budget.savingsTarget) : null,
      savingsRatePercent: percent(max(actualSavings, 0), income.total),
    },
    categories,
    alerts: categories.filter((c) => c.status !== 'ok').map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      status: c.status,
      message:
        c.status === 'exceeded'
          ? `${c.name} is over budget by ${money(dec(c.spent).minus(c.limit))}`
          : `${c.name} has used ${c.utilizationPercent}% of its ${c.limit} budget`,
    })),
  };
}

/** Month-by-month budget performance for the most recent N budgets. */
export async function budgetHistory(userId: string, months: number) {
  const budgets = await db('budgets').where({ user_id: userId }).orderBy('month', 'desc').limit(months);
  const out = [];
  for (const b of budgets) {
    const u = await budgetUtilization(userId, b.id);
    out.push({
      budgetId: b.id,
      month: u.month,
      limit: u.totals.limit,
      spent: u.totals.spent,
      utilizationPercent: u.totals.utilizationPercent,
      status: u.totals.status,
      income: u.totals.income,
      actualSavings: u.totals.actualSavings,
      savingsTarget: u.totals.savingsTarget,
      categoriesOverBudget: u.categories.filter((c) => c.status === 'exceeded').length,
    });
  }
  return out.reverse();
}
