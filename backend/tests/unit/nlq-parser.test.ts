import { describe, expect, it } from 'vitest';
import { detectIntent, parseAmount, parseMonthsAhead, parsePeriod, spendTarget } from '../../src/modules/assistant/nlq.parser';

describe('assistant language parsing', () => {
  it('detects the intent of the example questions', () => {
    expect(detectIntent('Where did my money go this month?')).toBe('where_money_went');
    expect(detectIntent('How much did I save this year?')).toBe('savings');
    expect(detectIntent('Which category consumes most of my income?')).toBe('top_category');
    expect(detectIntent('How much EMI do I have remaining?')).toBe('emi_remaining');
    expect(detectIntent('Can I afford a purchase of ₹50,000?')).toBe('affordability');
    expect(detectIntent('What will my savings look like after 6 months?')).toBe('savings_projection');
    expect(detectIntent('how much did I spend on food last month')).toBe('spend_on');
    expect(detectIntent('hello there')).toBe('help');
  });

  it('parses periods relative to today', () => {
    const today = '2026-11-07';
    expect(parsePeriod('this month', today)).toEqual({ from: '2026-11-01', to: '2026-11-07', label: 'this month' });
    expect(parsePeriod('last month', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(parsePeriod('this year', today)).toMatchObject({ from: '2026-01-01', to: today });
    expect(parsePeriod('in march', today)).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(parsePeriod('in december', today)).toMatchObject({ from: '2025-12-01' });
    expect(parsePeriod('past 3 months', today)).toMatchObject({ from: '2026-08-01', to: '2026-10-31' });
    expect(parsePeriod('how may I save', today).label).toBe('this month');
  });

  it('parses Indian amount formats', () => {
    expect(parseAmount('Can I afford ₹50,000?')).toBe('50000.00');
    expect(parseAmount('can i buy a bike for 1.5 lakh')).toBe('150000.00');
    expect(parseAmount('Rs. 2,50,000 car')).toBe('250000.00');
    expect(parseAmount('a 30k phone')).toBe('30000.00');
    expect(parseAmount('1 crore flat')).toBe('10000000.00');
    expect(parseAmount('nothing here')).toBeNull();
  });

  it('extracts horizons and spend targets', () => {
    expect(parseMonthsAhead('after 2 years')).toBe(24);
    expect(parseMonthsAhead('in 9 months')).toBe(9);
    expect(spendTarget('How much did I spend on food delivery last month?')).toBe('food delivery');
    expect(spendTarget('what did I spend at amazon?')).toBe('amazon');
  });
});
