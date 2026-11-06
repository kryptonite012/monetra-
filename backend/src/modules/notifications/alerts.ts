import { db } from '../../db/knex';
import { monthStart, todayIn } from '../../lib/dates';
import { logger } from '../../lib/logger';
import { money } from '../../lib/money';
import { budgetUtilization } from '../budgets/budgets.service';
import { notify } from './notifications.service';

/** Raises budget threshold / overspending alerts for the month containing `date`. */
export async function checkBudgetAlerts(userId: string, date = todayIn()): Promise<number> {
  const budget = await db('budgets').where({ user_id: userId, month: monthStart(date) }).first('id');
  if (!budget) return 0;
  const report = await budgetUtilization(userId, budget.id);
  let raised = 0;
  for (const c of report.categories) {
    if (c.status === 'ok') continue;
    const created = await notify(userId, {
      type: 'budget_threshold',
      severity: c.status === 'exceeded' ? 'critical' : 'warning',
      title: c.status === 'exceeded' ? `${c.name} budget exceeded` : `${c.name} budget at ${Math.floor(Number(c.utilizationPercent))}%`,
      body:
        c.status === 'exceeded'
          ? `You have spent ${money(c.spent)} against a ${money(c.limit)} budget for ${c.name} in ${report.month}.`
          : `You have used ${c.utilizationPercent}% of your ${money(c.limit)} ${c.name} budget for ${report.month}. ${money(c.remaining)} remains.`,
      actionUrl: '/budgets',
      data: { budgetId: budget.id, categoryId: c.categoryId, utilization: c.utilizationPercent },
      dedupeKey: `budget:${budget.id}:${c.categoryId}:${c.status}`,
    });
    if (created) raised += 1;
  }
  return raised;
}

/** Fire-and-forget wrapper used after writes; alert failures never fail the request. */
export function checkBudgetAlertsSoon(userId: string, date?: string): void {
  checkBudgetAlerts(userId, date).catch((err) => logger.warn({ err }, 'budget alert check failed'));
}
