/**
 * Calendar helpers for business dates (YYYY-MM-DD strings, no time zone drift).
 */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseISODate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Today's date in the given IANA time zone (defaults to India Standard Time). */
export function todayIn(timeZone = 'Asia/Kolkata', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Adds months, clamping to the last day of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const d = parseISODate(date);
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const clamped = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  return toISODate(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clamped)));
}

export function addDays(date: string, days: number): string {
  const d = parseISODate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function addPeriod(date: string, frequency: Frequency, interval = 1, anchorDay?: number): string {
  switch (frequency) {
    case 'daily':
      return addDays(date, interval);
    case 'weekly':
      return addDays(date, 7 * interval);
    case 'monthly':
      return addMonths(date, interval, anchorDay);
    case 'quarterly':
      return addMonths(date, 3 * interval, anchorDay);
    case 'yearly':
      return addMonths(date, 12 * interval, anchorDay);
  }
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const d = parseISODate(monthStart(date));
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/** Whole months from `from` to `to` (partial months are not counted). */
export function monthsBetween(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/** Indian financial year (April-March by default) containing a date. */
export function financialYear(date: string, startMonth = 4): { start: string; end: string; label: string } {
  const d = parseISODate(date);
  const year = d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const start = `${year}-${pad(startMonth)}-01`;
  const end = addDays(addMonths(start, 12), -1);
  return { start, end, label: startMonth === 1 ? String(year) : `FY ${year}-${String(year + 1).slice(2)}` };
}
