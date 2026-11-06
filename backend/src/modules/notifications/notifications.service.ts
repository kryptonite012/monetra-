import { config } from '../../config/env';
import { db, type Db } from '../../db/knex';
import { logger } from '../../lib/logger';
import { layout, sendMail } from '../../lib/mailer';

export type NotificationType =
  | 'unusual_spending' | 'budget_threshold' | 'emi_due' | 'bill_due' | 'subscription_renewal' | 'goal_milestone'
  | 'account_activity' | 'security_alert' | 'recurring_reminder' | 'report_ready' | 'system';

export interface NotificationInput {
  type: NotificationType;
  severity?: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
  /** Prevents the same alert from being raised twice (e.g. "bill:<id>:<due date>"). */
  dedupeKey?: string;
}

const PREF_KEY: Partial<Record<NotificationType, string>> = {
  unusual_spending: 'unusualSpending',
  budget_threshold: 'budgetThreshold',
  emi_due: 'emiDue',
  bill_due: 'billDue',
  subscription_renewal: 'subscriptionRenewal',
  goal_milestone: 'goalMilestone',
  account_activity: 'accountActivity',
  security_alert: 'securityAlert',
};

/** Email is opt-in per type, except security alerts which are on unless switched off. */
const EMAIL_DEFAULT_ON = new Set<NotificationType>(['security_alert']);

/**
 * Creates an in-app notification (respecting preferences and de-duplication)
 * and sends an email copy when the user has opted in for that type.
 * Returns the created notification or null if it was suppressed.
 */
export async function notify(userId: string, input: NotificationInput, conn: Db = db) {
  const profile = await conn('user_profiles as p').join('users as u', 'u.id', 'p.user_id').where('p.user_id', userId).first('p.preferences', 'u.email');
  if (!profile) return null;
  const prefs = (profile.preferences ?? {}) as { inAppNotifications?: Record<string, boolean>; emailNotifications?: Record<string, boolean> };
  const key = PREF_KEY[input.type];
  // Security alerts are always shown in-app.
  if (key && input.type !== 'security_alert' && prefs.inAppNotifications?.[key] === false) return null;

  const [row] = await conn('notifications')
    .insert({
      user_id: userId,
      type: input.type,
      severity: input.severity ?? 'info',
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      action_url: input.actionUrl ?? null,
      data: JSON.stringify(input.data ?? {}),
      dedupe_key: input.dedupeKey ?? null,
    })
    .onConflict(['user_id', 'dedupe_key'])
    .ignore()
    .returning('*');
  if (!row) return null;

  const emailPref = key ? prefs.emailNotifications?.[key] : undefined;
  const wantsEmail = emailPref ?? EMAIL_DEFAULT_ON.has(input.type);
  if (wantsEmail) {
    try {
      await sendMail({
        to: profile.email,
        subject: `${config.APP_NAME}: ${input.title}`,
        text: `${input.body}${input.actionUrl ? `\n\n${config.APP_URL}${input.actionUrl}` : ''}`,
        html: layout(input.title, [input.body], input.actionUrl ? { label: 'Open Monetra', url: `${config.APP_URL}${input.actionUrl}` } : undefined),
      });
      await conn('notifications').where({ id: row.id }).update({ emailed_at: conn.fn.now() });
    } catch (err) {
      logger.warn({ err, type: input.type }, 'notification email failed');
    }
  }
  return row;
}

export async function unreadCount(userId: string): Promise<number> {
  const [{ count }] = await db('notifications').where({ user_id: userId }).whereNull('read_at').count({ count: '*' });
  return Number(count);
}
