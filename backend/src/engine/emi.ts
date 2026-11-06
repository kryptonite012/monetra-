import { addMonths } from '../lib/dates';
import { D, dec, round2, type Dec, type MoneyInput } from '../lib/money';

/**
 * Equated Monthly Instalment (reducing balance):
 *   EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)
 *   r = annual rate / 12 / 100, n = tenure in months. If r = 0, EMI = P / n.
 */
export function calculateEmi(principal: MoneyInput, annualRatePct: MoneyInput, months: number): Dec {
  if (!Number.isInteger(months) || months <= 0) throw new RangeError('Tenure must be a positive number of months');
  const P = dec(principal);
  const r = dec(annualRatePct).div(1200);
  if (r.isZero()) return round2(P.div(months));
  const f = r.plus(1).pow(months);
  return round2(P.times(r).times(f).div(f.minus(1)));
}

/** Flat-rate EMI (interest on the original principal for the whole tenure): (P + P×R×T) / n. */
export function calculateFlatEmi(principal: MoneyInput, annualRatePct: MoneyInput, months: number): Dec {
  const P = dec(principal);
  const interest = P.times(dec(annualRatePct).div(100)).times(new D(months).div(12));
  return round2(P.plus(interest).div(months));
}

export interface Installment {
  installmentNo: number;
  dueDate: string;
  openingPrincipal: string;
  emi: string;
  interest: string;
  principal: string;
  closingPrincipal: string;
}

/**
 * Builds a reducing-balance amortisation schedule. Interest each month is
 * the outstanding principal × r (rounded to paise); the final instalment
 * absorbs rounding so the loan closes at exactly zero.
 */
export function amortizationSchedule(opts: {
  principal: MoneyInput;
  annualRatePct: MoneyInput;
  months: number;
  firstDueDate: string;
  emi?: MoneyInput;
  startNo?: number;
  interestType?: 'reducing' | 'flat';
}): Installment[] {
  const months = opts.months;
  let balance = round2(opts.principal);
  const r = dec(opts.annualRatePct).div(1200);
  const flat = opts.interestType === 'flat';
  const emi = opts.emi != null ? dec(opts.emi) : flat ? calculateFlatEmi(balance, opts.annualRatePct, months) : calculateEmi(balance, opts.annualRatePct, months);
  const flatInterest = flat ? round2(balance.times(dec(opts.annualRatePct).div(100)).times(new D(months).div(12)).div(months)) : null;
  const anchorDay = Number(opts.firstDueDate.slice(8, 10));
  const rows: Installment[] = [];
  for (let i = 0; i < months && balance.gt(0); i++) {
    const interest = flatInterest ?? round2(balance.times(r));
    let principalPart = emi.minus(interest);
    let payment = emi;
    if (principalPart.gte(balance) || i === months - 1) {
      principalPart = balance;
      payment = balance.plus(interest);
    }
    if (principalPart.lte(0)) throw new RangeError('EMI does not cover the monthly interest');
    const closing = balance.minus(principalPart);
    rows.push({
      installmentNo: (opts.startNo ?? 1) + i,
      dueDate: addMonths(opts.firstDueDate, i, anchorDay),
      openingPrincipal: balance.toFixed(2),
      emi: payment.toFixed(2),
      interest: interest.toFixed(2),
      principal: principalPart.toFixed(2),
      closingPrincipal: closing.toFixed(2),
    });
    balance = closing;
  }
  return rows;
}

/** Number of months needed to repay `outstanding` with a fixed EMI: n = −ln(1 − rP/E) / ln(1 + r). */
export function tenureForEmi(outstanding: MoneyInput, annualRatePct: MoneyInput, emi: MoneyInput): number {
  const P = dec(outstanding);
  const E = dec(emi);
  const r = dec(annualRatePct).div(1200);
  if (r.isZero()) return Math.ceil(P.div(E).toNumber());
  const x = new D(1).minus(r.times(P).div(E));
  if (x.lte(0)) throw new RangeError('EMI does not cover the monthly interest');
  // A tiny tolerance absorbs paise rounding in the EMI (e.g. 60.0002 months is 60 months).
  return Math.ceil(x.ln().neg().div(r.plus(1).ln()).toNumber() - 0.001);
}

/**
 * Effect of a part-prepayment on a reducing-balance loan. Compares total
 * remaining interest before and after, either keeping the EMI (shorter
 * tenure) or keeping the tenure (lower EMI).
 */
export function prepaymentImpact(opts: { outstanding: MoneyInput; annualRatePct: MoneyInput; emi: MoneyInput; remainingMonths: number; prepayment: MoneyInput; strategy: 'reduce_tenure' | 'reduce_emi' }) {
  const before = amortizationSchedule({ principal: opts.outstanding, annualRatePct: opts.annualRatePct, months: opts.remainingMonths, firstDueDate: '2000-01-01', emi: opts.emi });
  const interestBefore = before.reduce((s, r) => s.plus(r.interest), new D(0));
  const newOutstanding = dec(opts.outstanding).minus(dec(opts.prepayment));
  if (newOutstanding.lte(0)) {
    return { newOutstanding: '0.00', newEmi: '0.00', newTenureMonths: 0, interestBefore: interestBefore.toFixed(2), interestAfter: '0.00', interestSaved: interestBefore.toFixed(2) };
  }
  let newEmi = dec(opts.emi);
  let months = opts.remainingMonths;
  if (opts.strategy === 'reduce_tenure') months = tenureForEmi(newOutstanding, opts.annualRatePct, newEmi);
  else newEmi = calculateEmi(newOutstanding, opts.annualRatePct, months);
  const after = amortizationSchedule({ principal: newOutstanding, annualRatePct: opts.annualRatePct, months, firstDueDate: '2000-01-01', emi: newEmi });
  const interestAfter = after.reduce((s, r) => s.plus(r.interest), new D(0));
  return {
    newOutstanding: newOutstanding.toFixed(2),
    newEmi: newEmi.toFixed(2),
    newTenureMonths: after.length,
    interestBefore: interestBefore.toFixed(2),
    interestAfter: interestAfter.toFixed(2),
    interestSaved: interestBefore.minus(interestAfter).toFixed(2),
  };
}

/** Totals for an EMI quote (used by the loan calculator). */
export function emiQuote(principal: MoneyInput, annualRatePct: MoneyInput, months: number) {
  const emi = calculateEmi(principal, annualRatePct, months);
  const schedule = amortizationSchedule({ principal, annualRatePct, months, firstDueDate: '2000-01-01', emi });
  const totalPaid = schedule.reduce((s, r) => s.plus(r.emi), new D(0));
  return { emi: emi.toFixed(2), totalInterest: totalPaid.minus(dec(principal)).toFixed(2), totalPayment: totalPaid.toFixed(2) };
}
