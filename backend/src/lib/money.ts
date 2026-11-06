import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Money arithmetic for Monetra.
 *
 * All authoritative amounts are handled as arbitrary-precision decimals and
 * persisted as PostgreSQL NUMERIC(19,4). JavaScript numbers are never used
 * for balances: values travel through the API as decimal strings.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -20, toExpPos: 30 });
export type Dec = InstanceType<typeof D>;
export type MoneyInput = Dec | string | number | null | undefined;

export const ZERO = new D(0);

/** Converts an input into a Decimal, treating null/undefined/'' as zero. */
export function dec(value: MoneyInput): Dec {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof D) return value;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Non-finite amount');
  return new D(value);
}

export function sum(values: Iterable<MoneyInput>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(dec(v));
  return total;
}

/** Rounds to paise using banker's rounding (default) or half-up for display totals. */
export function round2(value: MoneyInput, mode: 'even' | 'up' = 'even'): Dec {
  return dec(value).toDecimalPlaces(2, mode === 'even' ? D.ROUND_HALF_EVEN : D.ROUND_HALF_UP);
}

/** Serialises a money value for API responses (2 decimal places). */
export function money(value: MoneyInput): string {
  return round2(value, 'up').toFixed(2);
}

/** Serialises a storage value (4 decimal places, the NUMERIC(19,4) scale). */
export function storage(value: MoneyInput): string {
  return dec(value).toDecimalPlaces(4, D.ROUND_HALF_EVEN).toFixed(4);
}

/** Percentage of part/whole with 2 decimals; returns '0.00' when whole is zero. */
export function percent(part: MoneyInput, whole: MoneyInput): string {
  const w = dec(whole);
  if (w.isZero()) return '0.00';
  return dec(part).div(w).times(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}

export function max(a: MoneyInput, b: MoneyInput): Dec {
  return D.max(dec(a), dec(b));
}

export function min(a: MoneyInput, b: MoneyInput): Dec {
  return D.min(dec(a), dec(b));
}

/**
 * Splits an amount into `parts` shares that always add up exactly to the
 * original amount; the remainder paise are distributed to the first shares.
 */
export function allocate(amount: MoneyInput, parts: number): Dec[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new RangeError('parts must be a positive integer');
  const totalPaise = round2(amount).times(100);
  const base = totalPaise.divToInt(parts);
  const remainder = totalPaise.minus(base.times(parts)).toNumber();
  return Array.from({ length: parts }, (_, i) => base.plus(i < Math.abs(remainder) ? Math.sign(remainder) : 0).div(100));
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Human-readable INR string (e.g. ₹1,23,456.70) using the Indian digit grouping. */
export function formatINR(value: MoneyInput): string {
  // Intl only accepts numbers; we format the rounded string, which is exact to 2dp.
  return INR.format(Number(money(value)));
}

const AMOUNT_RE = /^-?\d{1,15}(\.\d{1,4})?$/;

/**
 * Zod schema for money supplied by clients. Accepts strings or numbers,
 * validates at most 15 integer digits and 4 decimals and yields a string.
 */
export const moneySchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .refine((v) => AMOUNT_RE.test(v), 'Expected a decimal amount with up to 4 decimal places')
  .transform((v) => storage(v));

export const positiveMoney = moneySchema.refine((v) => dec(v).gt(0), 'Amount must be greater than zero');
export const nonNegativeMoney = moneySchema.refine((v) => dec(v).gte(0), 'Amount cannot be negative');

/** Annual interest/return rates expressed in percent, e.g. 8.5 for 8.5% p.a. */
export const rateSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && dec(v).lte(100), 'Expected a rate between 0 and 100');
