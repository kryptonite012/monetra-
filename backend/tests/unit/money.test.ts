import { describe, expect, it } from 'vitest';
import { allocate, dec, formatINR, money, moneySchema, percent, positiveMoney, round2, storage, sum } from '../../src/lib/money';

describe('money', () => {
  it('avoids binary floating point errors', () => {
    expect(dec('0.1').plus('0.2').toString()).toBe('0.3');
    expect(money(sum(['0.10', '0.20', 0.3]))).toBe('0.60');
  });

  it('uses banker rounding for storage and half-up for display', () => {
    expect(round2('2.345').toFixed(2)).toBe('2.34');
    expect(round2('2.355').toFixed(2)).toBe('2.36');
    expect(money('2.345')).toBe('2.35');
    expect(storage('10.12345')).toBe('10.1234');
  });

  it('allocates remainders so shares always add up exactly', () => {
    const shares = allocate('100.00', 3).map((d) => d.toFixed(2));
    expect(shares).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(shares).toFixed(2)).toBe('100.00');
    expect(sum(allocate('-10', 3)).toFixed(2)).toBe('-10.00');
    expect(() => allocate('10', 0)).toThrow();
  });

  it('computes percentages safely', () => {
    expect(percent('25', '200')).toBe('12.50');
    expect(percent('5', '0')).toBe('0.00');
  });

  it('formats rupees with Indian digit grouping', () => {
    expect(formatINR('1234567.891')).toBe('₹12,34,567.89');
  });

  it('validates client supplied amounts', () => {
    expect(moneySchema.parse(1500.5)).toBe('1500.5000');
    expect(moneySchema.parse(' 99.99 ')).toBe('99.9900');
    expect(moneySchema.safeParse('1e5').success).toBe(false);
    expect(moneySchema.safeParse('12.34567').success).toBe(false);
    expect(positiveMoney.safeParse('0').success).toBe(false);
    expect(positiveMoney.safeParse('-1').success).toBe(false);
  });
});
