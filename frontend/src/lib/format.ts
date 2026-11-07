const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Formats a decimal string from the API. Display only: arithmetic stays on the server. */
export function formatMoney(value: string | number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const s = opts.compact ? inrCompact.format(n) : inr.format(n);
  return opts.sign && n > 0 ? `+${s}` : s;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

export function formatMonth(value: string): string {
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : monthFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(new Date(value));
}

export function formatPercent(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}
