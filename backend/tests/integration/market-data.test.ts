import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env';
import { clearNavCache, setMarketDataFetcher } from '../../src/modules/market-data/market-data.service';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

const NAV_FILE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;84.5123;05-Nov-2026
`;

describe('market data providers', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    await api().post('/api/v1/investments').set(user.auth).send({ instrumentType: 'mutual_fund', name: 'PPFAS Flexi Cap', schemeCode: '122639', initial: { units: '100', price: '70', tradeDate: '2025-06-01' } });
  });
  afterAll(async () => {
    (config as { MARKET_DATA_PROVIDER: string }).MARKET_DATA_PROVIDER = 'none';
    await resetDatabase();
  });

  it('says clearly when no provider is configured', async () => {
    const res = await api().post('/api/v1/investments/refresh-prices').set(user.auth);
    expect(res.body.data).toMatchObject({ configured: false, updated: 0 });
    expect(res.body.data.message).toMatch(/manually entered/);
  });

  it('applies official AMFI NAVs labelled as delayed', async () => {
    (config as { MARKET_DATA_PROVIDER: string }).MARKET_DATA_PROVIDER = 'amfi';
    clearNavCache();
    setMarketDataFetcher(async () => ({ ok: true, status: 200, text: async () => NAV_FILE }));
    const res = await api().post('/api/v1/investments/refresh-prices').set(user.auth);
    expect(res.body.data).toMatchObject({ provider: 'AMFI', updated: 1 });
    const holdings = await api().get('/api/v1/investments').set(user.auth);
    expect(holdings.body.data[0]).toMatchObject({ currentValue: '8451.23', valuationSource: 'delayed', valuationLabel: 'Delayed (end-of-day) price', priceProvider: 'AMFI' });
  });

  it('keeps existing prices when the provider is unreachable', async () => {
    clearNavCache();
    setMarketDataFetcher(async () => ({ ok: false, status: 503, text: async () => '' }));
    const res = await api().post('/api/v1/investments/refresh-prices').set(user.auth);
    expect(res.body.data).toMatchObject({ updated: 0, skipped: 1 });
    expect(res.body.data.message).toMatch(/kept/);
  });
});
