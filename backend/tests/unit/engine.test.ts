import { describe, expect, it } from 'vitest';
import {
  absoluteReturn,
  accruedValue,
  amortizationSchedule,
  budgetUtilization,
  cagr,
  calculateEmi,
  calculateFlatEmi,
  compoundInterest,
  creditUtilization,
  debtToIncome,
  emiQuote,
  financialHealthScore,
  linearForecast,
  monthlyBurnRate,
  monthsToTarget,
  movingAverage,
  netWorth,
  prepaymentImpact,
  projectBalance,
  recurringDepositMaturity,
  requiredMonthlyContribution,
  runwayMonths,
  savingsRate,
  simpleInterest,
  tenureForEmi,
  xirr,
} from '../../src/engine';
import { sum } from '../../src/lib/money';

describe('EMI and amortisation', () => {
  it('matches standard EMI values', () => {
    expect(calculateEmi('1000000', '8.5', 240).toFixed(2)).toBe('8678.23');
    expect(calculateEmi('500000', '10.5', 60).toFixed(2)).toBe('10746.95');
    expect(calculateEmi('120000', '0', 12).toFixed(2)).toBe('10000.00');
    expect(() => calculateEmi('1000', '10', 0)).toThrow();
    expect(calculateFlatEmi('100000', '12', 12).toFixed(2)).toBe('9333.33');
  });

  it('builds a schedule that closes exactly at zero with month-end due dates', () => {
    const s = amortizationSchedule({ principal: '500000', annualRatePct: '10.5', months: 60, firstDueDate: '2026-01-31' });
    expect(s).toHaveLength(60);
    expect(s[0]).toMatchObject({ interest: '4375.00', principal: '6371.95', closingPrincipal: '493628.05' });
    expect(s[1].dueDate).toBe('2026-02-28');
    expect(s[2].dueDate).toBe('2026-03-31');
    expect(s.at(-1)!.closingPrincipal).toBe('0.00');
    expect(sum(s.map((r) => r.principal)).toFixed(2)).toBe('500000.00');
  });

  it('quotes totals, tenure for an EMI and prepayment savings', () => {
    expect(emiQuote('500000', '10.5', 60)).toEqual({ emi: '10746.95', totalInterest: '144816.99', totalPayment: '644816.99' });
    expect(tenureForEmi('500000', '10.5', '10746.95')).toBe(60);
    expect(() => tenureForEmi('500000', '12', '4000')).toThrow();
    const tenure = prepaymentImpact({ outstanding: '400000', annualRatePct: '9', emi: '10000', remainingMonths: 48, prepayment: '100000', strategy: 'reduce_tenure' });
    expect(tenure.newTenureMonths).toBeLessThan(48);
    expect(Number(tenure.interestSaved)).toBeGreaterThan(0);
    const emi = prepaymentImpact({ outstanding: '400000', annualRatePct: '9', emi: '10000', remainingMonths: 48, prepayment: '100000', strategy: 'reduce_emi' });
    expect(Number(emi.newEmi)).toBeLessThan(10000);
    expect(prepaymentImpact({ outstanding: '1000', annualRatePct: '9', emi: '500', remainingMonths: 2, prepayment: '5000', strategy: 'reduce_emi' }).newOutstanding).toBe('0.00');
  });
});

describe('interest', () => {
  it('computes simple, compound and recurring deposit interest', () => {
    expect(simpleInterest('50000', '6', 2).interest.toFixed(2)).toBe('6000.00');
    expect(compoundInterest('100000', '7', 5, 4).maturityAmount.toFixed(2)).toBe('141477.82');
    expect(compoundInterest('100000', '0', 5).interest.toFixed(2)).toBe('0.00');
    expect(recurringDepositMaturity('5000', '6.5', 12).maturityAmount.toFixed(2)).toBe('62143.23');
    expect(accruedValue('100000', '7', 0).toFixed(2)).toBe('100000.00');
    expect(() => compoundInterest('1', '1', 1, 0)).toThrow();
  });
});

describe('returns', () => {
  it('computes absolute return, CAGR and XIRR', () => {
    expect(absoluteReturn('10000', '12500')!.toFixed(2)).toBe('25.00');
    expect(absoluteReturn('0', '10')).toBeNull();
    expect(cagr('100000', '200000', 5)!.toFixed(2)).toBe('14.87');
    expect(cagr('0', '10', 1)).toBeNull();
    expect(xirr([{ date: '2025-01-01', amount: '-10000' }, { date: '2026-01-01', amount: '11000' }])!.toFixed(2)).toBe('10.00');
    const sip = xirr([
      { date: '2025-01-05', amount: '-5000' },
      { date: '2025-02-05', amount: '-5000' },
      { date: '2025-03-05', amount: '-5000' },
      { date: '2025-12-31', amount: '16500' },
    ]);
    expect(Number(sip)).toBeGreaterThan(10);
    expect(Number(sip)).toBeLessThan(14);
    expect(xirr([{ date: '2025-01-01', amount: '100' }, { date: '2025-06-01', amount: '100' }])).toBeNull();
  });
});

describe('ratios', () => {
  it('handles normal values and zero denominators', () => {
    expect(savingsRate('100000', '65000')!.toFixed(1)).toBe('35.0');
    expect(savingsRate('0', '100')).toBeNull();
    expect(debtToIncome('30000', '100000')!.toFixed(1)).toBe('30.0');
    expect(netWorth('500000', '750000').toFixed(2)).toBe('-250000.00');
    expect(budgetUtilization('4500', '4000')!.toFixed(1)).toBe('112.5');
    expect(budgetUtilization('1', '0')).toBeNull();
    expect(monthlyBurnRate('30000', 30).toFixed(2)).toBe('30416.67');
    expect(runwayMonths('300000', '50000')!.toFixed(1)).toBe('6.0');
    expect(creditUtilization('15000', '50000')!.toFixed(0)).toBe('30');
  });
});

describe('projections', () => {
  it('projects balances, goal dates and required contributions', () => {
    const p = projectBalance({ startBalance: '0', monthlyContribution: '1000', annualReturnPct: 0, months: 3, startDate: '2026-01-15' });
    expect(p).toEqual([
      { month: '2026-02', balance: '1000.00' },
      { month: '2026-03', balance: '2000.00' },
      { month: '2026-04', balance: '3000.00' },
    ]);
    expect(monthsToTarget('120000', '0', '10000')).toBe(12);
    expect(monthsToTarget('100', '200', '0')).toBe(0);
    expect(monthsToTarget('100', '0', '0')).toBeNull();
    expect(requiredMonthlyContribution('120000', '0', 12).toFixed(2)).toBe('10000.00');
    expect(Number(requiredMonthlyContribution('120000', '0', 12, 12))).toBeLessThan(10000);
    expect(requiredMonthlyContribution('100', '500', 12).toFixed(2)).toBe('0.00');
  });

  it('forecasts trends with an uncertainty band', () => {
    const f = linearForecast(['100', '200', '300'], 2);
    expect(f.forecasts.map((x) => x.value)).toEqual(['400.00', '500.00']);
    expect(f.standardError).toBe('0.00');
    const noisy = linearForecast(['30000', '34000', '29000', '36000'], 1);
    expect(Number(noisy.forecasts[0].high)).toBeGreaterThan(Number(noisy.forecasts[0].low));
    expect(linearForecast([], 3).forecasts).toEqual([]);
    expect(movingAverage(['10', '20', '30', '40'], 2).toFixed(0)).toBe('35');
  });
});

describe('financial health score', () => {
  it('rewards strong finances and explains each component', () => {
    const strong = financialHealthScore({ monthlyIncome: '150000', monthlyExpenses: '80000', liquidAssets: '600000', monthlyDebtPayments: '0', netWorth: '2500000', budgetAdherencePct: 100, creditUtilizationPct: 10 });
    expect(strong.score).toBe(100);
    expect(strong.grade).toBe('Excellent');
    const weak = financialHealthScore({ monthlyIncome: '50000', monthlyExpenses: '52000', liquidAssets: '10000', monthlyDebtPayments: '25000', netWorth: '-100000', creditUtilizationPct: 95 });
    expect(weak.score).toBeLessThan(25);
    expect(weak.components).toHaveLength(6);
    expect(weak.focusArea).not.toBeNull();
    expect(weak.methodology).toMatch(/not a credit score/);
  });
});
