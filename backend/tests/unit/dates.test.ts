import { describe, expect, it } from 'vitest';
import { addMonths, addPeriod, financialYear, monthEnd, monthsBetween, todayIn } from '../../src/lib/dates';

describe('date helpers', () => {
  it('clamps month arithmetic to month ends and keeps the anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addPeriod('2026-03-15', 'quarterly')).toBe('2026-06-15');
    expect(addPeriod('2026-03-15', 'weekly', 2)).toBe('2026-03-29');
  });

  it('computes month ends, month spans and financial years', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthsBetween('2026-01-15', '2026-07-14')).toBe(5);
    expect(financialYear('2026-02-10')).toEqual({ start: '2025-04-01', end: '2026-03-31', label: 'FY 2025-26' });
    expect(financialYear('2026-04-01').label).toBe('FY 2026-27');
  });

  it('resolves today in a time zone', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-03-31T20:00:00Z'))).toBe('2026-04-01');
  });
});
