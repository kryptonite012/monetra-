import type { Knex } from 'knex';
import { db, withTransaction } from '../../db/knex';
import { addPeriod, type Frequency } from '../../lib/dates';
import { logger } from '../../lib/logger';

export interface RecurringRule {
  id: string;
  userId: string;
  kind: 'income' | 'expense';
  name: string;
  accountId: string;
  amount: string;
  categoryId: string | null;
  paymentMethodId: string | null;
  incomeSource: string | null;
  merchantName: string | null;
  description: string;
  frequency: Frequency;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  nextRunOn: string;
  lastRunOn: string | null;
  autoPost: boolean;
  isActive: boolean;
}

/** Posts one occurrence of a rule. Income and expense modules register their handlers. */
export type OccurrenceHandler = (rule: RecurringRule, date: string, trx: Knex.Transaction) => Promise<unknown>;
const handlers: Partial<Record<RecurringRule['kind'], OccurrenceHandler>> = {};
export function registerRecurringHandler(kind: RecurringRule['kind'], handler: OccurrenceHandler) {
  handlers[kind] = handler;
}

/** Called when a rule is due but set to remind instead of auto-post. */
type ReminderHook = (rule: RecurringRule, date: string) => Promise<void>;
let reminderHook: ReminderHook | undefined;
export function setRecurringReminderHook(hook: ReminderHook) {
  reminderHook = hook;
}

export function nextOccurrence(rule: Pick<RecurringRule, 'frequency' | 'intervalCount' | 'startDate'>, after: string): string {
  const anchorDay = Number(rule.startDate.slice(8, 10));
  return addPeriod(after, rule.frequency, rule.intervalCount, anchorDay);
}

/** Upcoming dates for a rule (for previews and forecasts). */
export function upcomingDates(rule: Pick<RecurringRule, 'frequency' | 'intervalCount' | 'startDate' | 'endDate' | 'nextRunOn'>, until: string, max = 60): string[] {
  const out: string[] = [];
  let d = rule.nextRunOn;
  while (d <= until && (!rule.endDate || d <= rule.endDate) && out.length < max) {
    out.push(d);
    d = nextOccurrence(rule, d);
  }
  return out;
}

const MAX_CATCH_UP = 12;

/**
 * Materialises every due occurrence up to `today` (catching up missed runs,
 * at most 12 per rule per pass). Each occurrence posts in its own database
 * transaction together with advancing next_run_on, so a run is never posted twice.
 */
export async function processDueRules(today: string, opts: { userId?: string } = {}) {
  const q = db('recurring_rules').where({ is_active: true }).where('next_run_on', '<=', today);
  if (opts.userId) q.where({ user_id: opts.userId });
  const due: RecurringRule[] = await q;
  let posted = 0;
  let reminders = 0;
  for (const rule of due) {
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const outcome = await withTransaction(async (trx) => {
        const current: RecurringRule | undefined = await trx('recurring_rules').where({ id: rule.id }).forUpdate().first();
        if (!current || !current.isActive || current.nextRunOn > today) return 'done';
        const date = current.nextRunOn;
        if (current.endDate && date > current.endDate) {
          await trx('recurring_rules').where({ id: rule.id }).update({ is_active: false });
          return 'done';
        }
        let result: 'posted' | 'reminded' = 'reminded';
        if (current.autoPost && handlers[current.kind]) {
          await handlers[current.kind]!(current, date, trx);
          result = 'posted';
        }
        const next = nextOccurrence(current, date);
        await trx('recurring_rules')
          .where({ id: rule.id })
          .update({ last_run_on: date, next_run_on: next, is_active: !current.endDate || next <= current.endDate });
        if (result === 'reminded') await reminderHook?.(current, date);
        return result;
      }).catch((err) => {
        logger.error({ err, ruleId: rule.id }, 'recurring rule failed');
        return 'done' as const;
      });
      if (outcome === 'done') break;
      if (outcome === 'posted') posted += 1;
      else reminders += 1;
    }
  }
  return { rulesChecked: due.length, posted, reminders };
}
