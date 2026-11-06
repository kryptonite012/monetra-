import { describe, expect, it } from 'vitest';
import { parseAmfiNav } from '../../src/modules/market-data/amfi';

const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

PPFAS Mutual Fund

122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;84.5123;05-Nov-2026
119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund  - DIRECT - IDCW;105.3542;05-Nov-2026
999999;-;-;Broken Fund;N.A.;05-Nov-2026
`;

describe('AMFI NAV parser', () => {
  it('indexes NAVs by scheme code and ISIN', () => {
    const navs = parseAmfiNav(SAMPLE);
    expect(navs.get('code:122639')).toMatchObject({ nav: '84.5123', date: '2026-11-05' });
    expect(navs.get('isin:INF879O01027')?.schemeCode).toBe('122639');
    expect(navs.get('isin:INF209KA13Z9')?.nav).toBe('105.3542');
    expect(navs.has('code:999999')).toBe(false);
  });
});
