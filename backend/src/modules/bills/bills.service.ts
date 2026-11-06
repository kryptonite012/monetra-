import { addDays, addMonths, daysBetween, todayIn } from '../../lib/dates';
import { dec, money, sum } from '../../lib/money';
import { db } from '../../db/knex';

export const BILL_TYPE_CATEGORY: Record<string, string> = {
  electricity: 'utilities.electricity',
  water: 'utilities.water',
  gas: 'utilities.gas',
  internet: 'utilities.internet',
  mobile: 'utilities.mobile',
  dth: 'utilities.dth',
  rent: 'housing.rent',
  insurance: 'health.insurance',
  maintenance: 'housing.maintenance',
  education: 'education.fees',
  tax: 'financial.taxes',
  other: 'expense.other',
};

const BILL_MONTHS: Record<string, number> = { monthly: 1, bimonthly: 2, quarterly: 3, half_yearly: 6, yearly: 12 };
const SUB_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

export function nextBillDue(current: string, frequency: string): string {
  return addMonths(current, BILL_MONTHS[frequency] ?? 1);
}

export function nextRenewal(current: string, cycle: string): string {
  return cycle === 'weekly' ? addDays(current, 7) : addMonths(current, SUB_MONTHS[cycle] ?? 1);
}

/** Converts a subscription price to its monthly equivalent. */
export function monthlyEquivalent(amount: string, cycle: string) {
  if (cycle === 'weekly') return dec(amount).times(52).div(12);
  return dec(amount).div(SUB_MONTHS[cycle] ?? 1);
}

export function dueStatus(date: string, reminderDays: number) {
  const today = todayIn();
  const days = daysBetween(today, date);
  return { daysUntilDue: days, overdue: days < 0, dueSoon: days >= 0 && days <= reminderDays };
}

/** Bills and subscription renewals due in the next N days (overdue first). */
export async function upcomingPayments(userId: string, days: number) {
  const until = addDays(todayIn(), days);
  const bills: Array<Record<string, any>> = await db('bills').where({ user_id: userId, status: 'active' }).where('next_due_date', '<=', until);
  const subs: Array<Record<string, any>> = await db('subscriptions').where({ user_id: userId, status: 'active' }).where('next_renewal_date', '<=', until);
  const items = [
    ...bills.map((b) => ({ kind: 'bill' as const, id: b.id, name: b.name, type: b.billType, dueDate: b.nextDueDate, amount: b.expectedAmount != null ? money(b.expectedAmount) : null, amountType: b.amountType, autoPay: b.autoPay, ...dueStatus(b.nextDueDate, b.reminderDaysBefore) })),
    ...subs.map((s) => ({ kind: 'subscription' as const, id: s.id, name: s.name, type: s.billingCycle, dueDate: s.nextRenewalDate, amount: money(s.amount), amountType: 'fixed', autoPay: s.autoRenew, ...dueStatus(s.nextRenewalDate, s.reminderDaysBefore) })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    until,
    items,
    totalExpected: money(sum(items.map((i) => i.amount ?? 0))),
    overdueCount: items.filter((i) => i.overdue).length,
  };
}

/** Subscription costs and candidates for cancellation (no recorded use for 60+ days). */
export async function subscriptionSummary(userId: string) {
  const subs: Array<Record<string, any>> = await db('subscriptions').where({ user_id: userId, status: 'active' });
  const today = todayIn();
  const monthly = sum(subs.map((s) => monthlyEquivalent(s.amount, s.billingCycle)));
  const unused = subs
    .filter((s) => {
      const lastUse = s.lastUsedOn ?? s.startDate ?? String(s.createdAt).slice(0, 10);
      return daysBetween(lastUse, today) > 60;
    })
    .map((s) => ({ id: s.id, name: s.name, monthlyCost: money(monthlyEquivalent(s.amount, s.billingCycle)), lastUsedOn: s.lastUsedOn, reason: s.lastUsedOn ? 'Not used in over 60 days' : 'No usage recorded' }));
  return {
    activeCount: subs.length,
    monthlyCost: money(monthly),
    yearlyCost: money(monthly.times(12)),
    potentialMonthlySavings: money(sum(unused.map((u) => u.monthlyCost))),
    possiblyUnused: unused,
  };
}
