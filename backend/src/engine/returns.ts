import { D, dec, type Dec, type MoneyInput } from '../lib/money';
import { parseISODate } from '../lib/dates';

/** Absolute return % = (current − invested) / invested × 100. */
export function absoluteReturn(invested: MoneyInput, current: MoneyInput): Dec | null {
  const i = dec(invested);
  if (i.isZero()) return null;
  return dec(current).minus(i).div(i).times(100);
}

/** CAGR = (end / start)^(1 / years) − 1. Undefined for non-positive values or periods under ~1 month. */
export function cagr(start: MoneyInput, end: MoneyInput, years: number): Dec | null {
  const s = dec(start);
  const e = dec(end);
  if (s.lte(0) || e.lte(0) || years < 1 / 12) return null;
  return e.div(s).pow(new D(1).div(years)).minus(1).times(100);
}

export interface CashFlow {
  date: string;
  /** Negative for money invested, positive for money received / current value. */
  amount: MoneyInput;
}

/**
 * XIRR: the annual rate r for which Σ CFᵢ / (1 + r)^((dᵢ − d₀)/365) = 0.
 * Solved with Newton–Raphson, falling back to bisection. Returns % or null
 * if the cash flows do not contain both an outflow and an inflow.
 */
export function xirr(flows: CashFlow[]): Dec | null {
  if (flows.length < 2) return null;
  const values = flows.map((f) => dec(f.amount));
  if (!values.some((v) => v.isNegative()) || !values.some((v) => v.isPositive())) return null;
  const t0 = parseISODate(flows[0].date).getTime();
  const years = flows.map((f) => (parseISODate(f.date).getTime() - t0) / (365 * 86_400_000));
  const amounts = values.map((v) => v.toNumber());
  const npv = (r: number) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + r, years[i]), 0);
  const dnpv = (r: number) => amounts.reduce((s, a, i) => s - (years[i] * a) / Math.pow(1 + r, years[i] + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const d = dnpv(rate);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = rate - f / d;
    if (next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-10) return new D(next).times(100).toDecimalPlaces(4);
    rate = next;
  }
  let lo = -0.9999;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return new D((lo + hi) / 2).times(100).toDecimalPlaces(4);
}
