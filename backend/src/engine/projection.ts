import { addMonths } from '../lib/dates';
import { D, dec, round2, type Dec, type MoneyInput } from '../lib/money';

/**
 * Month-by-month projection of a balance with a fixed monthly contribution
 * and an assumed annual return compounded monthly:
 *   Bₖ = Bₖ₋₁ × (1 + r/12) + C
 */
export function projectBalance(opts: { startBalance: MoneyInput; monthlyContribution: MoneyInput; annualReturnPct?: MoneyInput; months: number; startDate: string }) {
  const r = dec(opts.annualReturnPct ?? 0).div(1200);
  let balance: Dec = dec(opts.startBalance);
  const out: Array<{ month: string; balance: string }> = [];
  for (let i = 1; i <= opts.months; i++) {
    balance = balance.times(r.plus(1)).plus(dec(opts.monthlyContribution));
    out.push({ month: addMonths(opts.startDate, i).slice(0, 7), balance: round2(balance).toFixed(2) });
  }
  return out;
}

/** Months until `current` reaches `target` with monthly contributions and return; null if never. */
export function monthsToTarget(target: MoneyInput, current: MoneyInput, monthlyContribution: MoneyInput, annualReturnPct: MoneyInput = 0, maxMonths = 1200): number | null {
  const t = dec(target);
  let b = dec(current);
  if (b.gte(t)) return 0;
  const c = dec(monthlyContribution);
  const r = dec(annualReturnPct).div(1200);
  if (c.lte(0) && r.lte(0)) return null;
  for (let m = 1; m <= maxMonths; m++) {
    b = b.times(r.plus(1)).plus(c);
    if (b.gte(t)) return m;
  }
  return null;
}

/**
 * Monthly contribution needed to reach a target in n months:
 *   C = (T − P(1+r)ⁿ) × r / ((1+r)ⁿ − 1)        (r > 0)
 *   C = (T − P) / n                               (r = 0)
 */
export function requiredMonthlyContribution(target: MoneyInput, current: MoneyInput, months: number, annualReturnPct: MoneyInput = 0): Dec {
  if (months <= 0) return D.max(dec(target).minus(dec(current)), 0);
  const T = dec(target);
  const P = dec(current);
  const r = dec(annualReturnPct).div(1200);
  if (r.isZero()) return D.max(round2(T.minus(P).div(months)), 0);
  const f = r.plus(1).pow(months);
  return D.max(round2(T.minus(P.times(f)).times(r).div(f.minus(1))), 0);
}

/**
 * Ordinary least squares trend line over equally spaced observations,
 * used for expenditure forecasts. Returns the fitted slope/intercept and
 * forecasts for the next `ahead` periods, plus the residual standard error
 * so callers can present a range rather than a single certain number.
 */
export function linearForecast(values: MoneyInput[], ahead: number) {
  const n = values.length;
  if (n === 0) return { slope: '0', intercept: '0', forecasts: [] as Array<{ value: string; low: string; high: string }>, standardError: '0' };
  const ys = values.map((v) => dec(v));
  if (n === 1) {
    return { slope: '0', intercept: ys[0].toFixed(2), forecasts: Array.from({ length: ahead }, () => ({ value: ys[0].toFixed(2), low: ys[0].toFixed(2), high: ys[0].toFixed(2) })), standardError: '0' };
  }
  const xs = ys.map((_, i) => new D(i));
  const meanX = xs.reduce((s, x) => s.plus(x), new D(0)).div(n);
  const meanY = ys.reduce((s, y) => s.plus(y), new D(0)).div(n);
  let sxy = new D(0);
  let sxx = new D(0);
  for (let i = 0; i < n; i++) {
    sxy = sxy.plus(xs[i].minus(meanX).times(ys[i].minus(meanY)));
    sxx = sxx.plus(xs[i].minus(meanX).pow(2));
  }
  const slope = sxx.isZero() ? new D(0) : sxy.div(sxx);
  const intercept = meanY.minus(slope.times(meanX));
  let sse = new D(0);
  for (let i = 0; i < n; i++) sse = sse.plus(ys[i].minus(intercept.plus(slope.times(i))).pow(2));
  const se = n > 2 ? sse.div(n - 2).sqrt() : new D(0);
  const forecasts = Array.from({ length: ahead }, (_, k) => {
    const v = D.max(intercept.plus(slope.times(n + k)), 0);
    return { value: round2(v).toFixed(2), low: round2(D.max(v.minus(se.times(1.645)), 0)).toFixed(2), high: round2(v.plus(se.times(1.645))).toFixed(2) };
  });
  return { slope: slope.toFixed(4), intercept: intercept.toFixed(2), forecasts, standardError: se.toFixed(2) };
}

/** Simple mean of the last `window` values. */
export function movingAverage(values: MoneyInput[], window: number): Dec {
  const slice = values.slice(-window);
  if (!slice.length) return new D(0);
  return slice.reduce<Dec>((s, v) => s.plus(dec(v)), new D(0)).div(slice.length);
}
