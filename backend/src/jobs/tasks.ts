import { db } from '../db/knex';
import { addDays, daysBetween, todayIn } from '../lib/dates';
import { logger } from '../lib/logger';
import { formatINR as money } from '../lib/money';
import { detectAnomalies } from '../modules/assistant/anomaly';
import { checkBudgetAlerts } from '../modules/notifications/alerts';
import { notify } from '../modules/notifications/notifications.service';
import { snapshotNetWorth } from '../modules/networth/networth.service';
import { processDueRules } from '../modules/recurring/recurring.service';

/** Posts (or reminds about) recurring income and expenses that are due. */
export async function runRecurring(today = todayIn()) {
  return processDueRules(today);
}

/** Reminders for bills due within their reminder window, and overdue alerts. */
export async function billReminders(today = todayIn()) {
  const bills: Array<Record<string, any>> = await db('bills').where({ status: 'active' }).where('next_due_date', '<=', addDays(today, 30));
  let sent = 0;
  for (const b of bills) {
    const days = daysBetween(today, b.nextDueDate);
    if (days > b.reminderDaysBefore) continue;
    const overdue = days < 0;
    const created = await notify(b.userId, {
      type: 'bill_due',
      severity: overdue ? 'critical' : 'warning',
      title: overdue ? `${b.name} is overdue` : days === 0 ? `${b.name} is due today` : `${b.name} due in ${days} day${days === 1 ? '' : 's'}`,
      body: `${b.name}${b.expectedAmount ? ` (${money(b.expectedAmount)})` : ''} ${overdue ? 'was' : 'is'} due on ${b.nextDueDate}.${b.autoPay ? ' Auto-pay is on; confirm it went through.' : ''}`,
      actionUrl: '/bills',
      data: { billId: b.id, dueDate: b.nextDueDate },
      dedupeKey: `bill:${b.id}:${b.nextDueDate}:${overdue ? 'overdue' : 'reminder'}`,
    });
    if (created) sent += 1;
  }
  return { sent };
}

export async function subscriptionReminders(today = todayIn()) {
  const subs: Array<Record<string, any>> = await db('subscriptions').where({ status: 'active' }).where('next_renewal_date', '<=', addDays(today, 30)).where('next_renewal_date', '>=', today);
  let sent = 0;
  for (const s of subs) {
    const days = daysBetween(today, s.nextRenewalDate);
    if (days > s.reminderDaysBefore) continue;
    const created = await notify(s.userId, {
      type: 'subscription_renewal',
      severity: 'info',
      title: `${s.name} renews ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`,
      body: `${s.name} will ${s.autoRenew ? 'auto-renew' : 'need renewal'} for ${money(s.amount)} on ${s.nextRenewalDate}. Cancel it beforehand if you no longer use it.`,
      actionUrl: '/bills?tab=subscriptions',
      data: { subscriptionId: s.id },
      dedupeKey: `subscription:${s.id}:${s.nextRenewalDate}`,
    });
    if (created) sent += 1;
  }
  return { sent };
}

/** EMI reminders five days ahead and overdue alerts. */
export async function emiReminders(today = todayIn()) {
  const due: Array<Record<string, any>> = await db('loan_installments as i')
    .join('loans as l', 'l.id', 'i.loan_id')
    .where('i.status', 'due')
    .where('l.status', 'active')
    .where('i.due_date', '<=', addDays(today, 5))
    .select('i.*', 'l.name as loan_name', 'l.lender');
  let sent = 0;
  for (const i of due) {
    const overdue = i.dueDate < today;
    const created = await notify(i.userId, {
      type: 'emi_due',
      severity: overdue ? 'critical' : 'warning',
      title: overdue ? `EMI overdue: ${i.loanName}` : `EMI due ${i.dueDate}: ${i.loanName}`,
      body: `Instalment #${i.installmentNo} of ${money(i.emiAmount)} to ${i.lender} ${overdue ? 'was' : 'is'} due on ${i.dueDate}. Keep enough balance in your repayment account.`,
      actionUrl: '/loans',
      data: { loanId: i.loanId, installmentNo: i.installmentNo },
      dedupeKey: `emi:${i.id}:${overdue ? 'overdue' : 'reminder'}`,
    });
    if (created) sent += 1;
  }
  return { sent };
}

export async function budgetAlerts(today = todayIn()) {
  const users = await db('budgets').where({ month: `${today.slice(0, 7)}-01` }).distinct('user_id');
  let raised = 0;
  for (const u of users) raised += await checkBudgetAlerts(u.userId, today);
  return { raised };
}

/** Unusual-spending alerts for the last two days of activity. */
export async function unusualSpending(today = todayIn()) {
  const from = addDays(today, -1);
  const users = await db('transactions').where('occurred_on', '>=', from).whereIn('kind', ['expense', 'bill_payment']).distinct('user_id');
  let raised = 0;
  for (const u of users) {
    for (const a of await detectAnomalies(u.userId, from, today)) {
      const created = await notify(u.userId, {
        type: 'unusual_spending',
        severity: 'warning',
        title: `Unusually large expense: ${money(a.amount)}`,
        body: `"${a.description}" on ${a.occurredOn} is ${a.reason}. If you don't recognise it, check your account.`,
        actionUrl: `/transactions?highlight=${a.transactionId}`,
        data: a as unknown as Record<string, unknown>,
        dedupeKey: `anomaly:${a.transactionId}`,
      });
      if (created) raised += 1;
    }
  }
  return { raised };
}

export async function netWorthSnapshots(today = todayIn()) {
  const users = await db('users').where({ status: 'active' }).whereNull('deleted_at').whereExists(db('accounts').whereRaw('accounts.user_id = users.id')).select('id');
  for (const u of users) await snapshotNetWorth(u.id, today);
  return { snapshots: users.length };
}

/** Removes expired security artefacts that are no longer needed. */
export async function retentionCleanup() {
  const tokens = await db('auth_tokens').where('expires_at', '<', db.raw(`now() - interval '7 days'`)).delete();
  const sessions = await db('sessions').where((q) => q.where('expires_at', '<', db.raw(`now() - interval '30 days'`)).orWhere('revoked_at', '<', db.raw(`now() - interval '90 days'`))).delete();
  const logins = await db('login_events').where('created_at', '<', db.raw(`now() - interval '365 days'`)).delete();
  return { tokens, sessions, logins };
}

export const TASKS = {
  recurring: runRecurring,
  billReminders,
  subscriptionReminders,
  emiReminders,
  budgetAlerts,
  unusualSpending,
  netWorthSnapshots,
  retentionCleanup,
} as const;

export type TaskName = keyof typeof TASKS;

/** Runs every task, isolating failures so one broken task never blocks the others. */
export async function runAllTasks(today = todayIn()) {
  const results: Record<string, unknown> = {};
  for (const [name, task] of Object.entries(TASKS)) {
    const started = Date.now();
    try {
      results[name] = await (task as (d?: string) => Promise<unknown>)(today);
      logger.info({ task: name, ms: Date.now() - started, result: results[name] }, 'job task finished');
    } catch (err) {
      results[name] = { error: (err as Error).message };
      logger.error({ err, task: name }, 'job task failed');
    }
  }
  return results;
}
