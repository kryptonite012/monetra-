import { D, dec, type Dec, type MoneyInput } from '../lib/money';

/**
 * Simple interest: I = P × r × t
 *   P = principal, r = annual rate (decimal), t = years.
 */
export function simpleInterest(principal: MoneyInput, annualRatePct: MoneyInput, years: MoneyInput) {
  const p = dec(principal);
  const interest = p.times(dec(annualRatePct).div(100)).times(dec(years));
  return { principal: p, interest, maturityAmount: p.plus(interest) };
}

/**
 * Compound interest: A = P × (1 + r/n)^(n×t)
 *   n = compounding periods per year (4 = quarterly, the convention for Indian FDs).
 */
export function compoundInterest(principal: MoneyInput, annualRatePct: MoneyInput, years: MoneyInput, compoundsPerYear = 4) {
  if (compoundsPerYear <= 0) throw new RangeError('compoundsPerYear must be positive');
  const p = dec(principal);
  const r = dec(annualRatePct).div(100);
  const amount = p.times(new D(1).plus(r.div(compoundsPerYear)).pow(dec(years).times(compoundsPerYear)));
  return { principal: p, interest: amount.minus(p), maturityAmount: amount };
}

/**
 * Recurring deposit maturity (Indian banks: quarterly compounding).
 * Each monthly instalment i (1..n) compounds for (n - i + 1) months:
 *   M = Σ R × (1 + r/4)^(4 × months_i / 12)
 */
export function recurringDepositMaturity(monthlyInstallment: MoneyInput, annualRatePct: MoneyInput, months: number) {
  const R = dec(monthlyInstallment);
  const q = new D(1).plus(dec(annualRatePct).div(400));
  let total: Dec = new D(0);
  for (let i = 1; i <= months; i++) total = total.plus(R.times(q.pow(new D(months - i + 1).div(3))));
  const deposited = R.times(months);
  return { deposited, interest: total.minus(deposited), maturityAmount: total };
}

/** Value accrued so far on a compounding deposit (for FD valuation between start and maturity). */
export function accruedValue(principal: MoneyInput, annualRatePct: MoneyInput, daysElapsed: number, compoundsPerYear = 4) {
  return compoundInterest(principal, annualRatePct, new D(Math.max(0, daysElapsed)).div(365), compoundsPerYear).maturityAmount;
}
