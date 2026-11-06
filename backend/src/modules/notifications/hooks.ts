import { money } from '../../lib/money';
import { setRefreshReuseHook } from '../auth/refresh.service';
import { setGoalMilestoneHook } from '../goals/goals.service';
import { setRecurringReminderHook } from '../recurring/recurring.service';
import { notify } from './notifications.service';

/** Connects domain events to notifications. Called once at start-up. */
export function registerNotificationHooks(): void {
  setRefreshReuseHook(async (userId) => {
    await notify(userId, {
      type: 'security_alert',
      severity: 'critical',
      title: 'Suspicious sign-in activity blocked',
      body: 'An old session token was reused, so we signed out the affected devices. If this was not you, change your password and enable two-factor authentication.',
      actionUrl: '/settings/security',
    });
  });

  setGoalMilestoneHook(async (goal, milestone) => {
    await notify(goal.userId, {
      type: 'goal_milestone',
      severity: milestone === 100 ? 'success' : 'info',
      title: milestone === 100 ? `Goal achieved: ${goal.name}` : `${goal.name} is ${milestone}% funded`,
      body: milestone === 100 ? `You reached your target of ${money(goal.targetAmount)}. Well done!` : `You have saved ${money(goal.savedAmount)} of ${money(goal.targetAmount)}.`,
      actionUrl: '/goals',
      data: { goalId: goal.id, milestone },
      dedupeKey: `goal:${goal.id}:${milestone}`,
    });
  });

  setRecurringReminderHook(async (rule, date) => {
    await notify(rule.userId, {
      type: 'recurring_reminder',
      severity: 'info',
      title: `${rule.name} is due`,
      body: `Your recurring ${rule.kind} of ${money(rule.amount)} was due on ${date}. Record it once it has happened.`,
      actionUrl: rule.kind === 'income' ? '/income' : '/expenses',
      data: { ruleId: rule.id, date },
      dedupeKey: `recurring:${rule.id}:${date}`,
    });
  });
}
