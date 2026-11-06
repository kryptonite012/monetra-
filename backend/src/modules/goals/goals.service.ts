import { db, type Db } from '../../db/knex';
import { monthsToTarget, requiredMonthlyContribution } from '../../engine';
import { addMonths, monthsBetween, todayIn } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { dec, money, sum } from '../../lib/money';

type MilestoneHook = (goal: Record<string, any>, milestone: number) => Promise<void>;
let milestoneHook: MilestoneHook | undefined;
export function setGoalMilestoneHook(hook: MilestoneHook) {
  milestoneHook = hook;
}

/**
 * Goal progress with an estimated completion date. The estimate uses the
 * planned monthly contribution, or the average of the last three months of
 * contributions, plus the goal's expected return. It is an estimate only.
 */
export function decorateGoal(goal: Record<string, any>, contributions: Array<Record<string, any>>): Record<string, any> {
  const today = todayIn();
  const saved = sum(contributions.map((c) => c.amount));
  const target = dec(goal.targetAmount);
  const remaining = target.minus(saved);
  const threeMonthsAgo = addMonths(today, -3);
  const recent = sum(contributions.filter((c) => c.contributedOn > threeMonthsAgo).map((c) => c.amount));
  const recentAverage = recent.div(3);
  const pace = goal.monthlyContribution != null ? dec(goal.monthlyContribution) : recentAverage;
  const months = monthsToTarget(target, saved, pace, goal.expectedReturnRate ?? 0);
  const estimatedCompletionDate = months === null ? null : months === 0 ? today : addMonths(today, months);
  const monthsLeft = goal.targetDate ? Math.max(0, monthsBetween(today, goal.targetDate)) : null;
  const required = goal.targetDate && remaining.gt(0) ? requiredMonthlyContribution(target, saved, Math.max(monthsLeft ?? 0, 1), goal.expectedReturnRate ?? 0) : null;
  let onTrack: boolean | null = null;
  if (remaining.lte(0)) onTrack = true;
  else if (goal.targetDate && estimatedCompletionDate) onTrack = estimatedCompletionDate <= goal.targetDate;
  else if (goal.targetDate) onTrack = false;
  return {
    ...goal,
    targetAmount: money(target),
    monthlyContribution: goal.monthlyContribution != null ? money(goal.monthlyContribution) : null,
    savedAmount: money(saved),
    remainingAmount: money(remaining.isNegative() ? 0 : remaining),
    completionPercent: target.isZero() ? '0.00' : dec(saved).div(target).times(100).toDecimalPlaces(2).toFixed(2),
    averageMonthlyContribution: money(recentAverage),
    estimatedCompletionDate,
    requiredMonthlyContribution: required ? money(required) : null,
    monthsLeft,
    onTrack,
    estimateNote:
      months === null
        ? 'Add a monthly contribution plan or make contributions to estimate a completion date.'
        : 'Estimate based on your contribution pace and expected return; actual results will vary.',
  };
}

export async function goalDetails(userId: string, goalId: string, conn: Db = db): Promise<Record<string, any>> {
  const goal = await conn('savings_goals').where({ id: goalId, user_id: userId }).first();
  if (!goal) throw notFound('Goal');
  const contributions = await conn('goal_contributions').where({ goal_id: goalId }).orderBy('contributed_on', 'desc');
  return { ...decorateGoal(goal, contributions), contributions: contributions.map((c: any) => ({ ...c, amount: money(c.amount) })) };
}

export async function listGoals(userId: string, status?: string) {
  const q = db('savings_goals').where({ user_id: userId }).orderBy([{ column: 'priority' }, { column: 'created_at' }]);
  if (status) q.where({ status });
  const goals = await q;
  if (!goals.length) return [];
  const contributions: Array<Record<string, any>> = await db('goal_contributions').whereIn('goal_id', goals.map((g: any) => g.id));
  return goals.map((g: any) => decorateGoal(g, contributions.filter((c) => c.goalId === g.id)));
}

const MILESTONES = [25, 50, 75, 100];

/** Re-evaluates achievement status and fires milestone hooks crossed by the latest contribution. */
export async function evaluateGoalProgress(userId: string, goalId: string, previousPercent: number) {
  const goal = await goalDetails(userId, goalId);
  const current = Number(goal.completionPercent);
  for (const m of MILESTONES) {
    if (previousPercent < m && current >= m) await milestoneHook?.(goal, m);
  }
  if (current >= 100 && goal.status === 'active') {
    await db('savings_goals').where({ id: goalId }).update({ status: 'achieved', achieved_at: db.fn.now() });
  } else if (current < 100 && goal.status === 'achieved') {
    await db('savings_goals').where({ id: goalId }).update({ status: 'active', achieved_at: null });
  }
}
