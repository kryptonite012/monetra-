import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

describe('investments', () => {
  let user: TestUser;
  let demat: { id: string };
  let stockId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    demat = await createAccount(user, { name: 'Zerodha funds', openingBalance: '500000', openingDate: '2024-01-01' });
  });
  afterAll(resetDatabase);

  it('adds a stock with its first purchase and debits the cash account', async () => {
    const res = await api()
      .post('/api/v1/investments')
      .set(user.auth)
      .send({ instrumentType: 'stock', name: 'Infosys Ltd', symbol: 'infy', exchange: 'NSE', isin: 'INE009A01021', riskLevel: 'high', initial: { units: '10', price: '1500', fees: '20', tradeDate: '2025-01-10', cashAccountId: demat.id } });
    expect(res.status).toBe(201);
    stockId = res.body.data.id;
    expect(res.body.data).toMatchObject({ symbol: 'INFY', units: '10', investedAmount: '15020.00', averageCost: '1502.0000', valuationSource: 'manual' });
    expect(await balanceOf(user, demat.id)).toBe('484980.00');
  });

  it('uses average cost for sells and tracks realised gains', async () => {
    await api().post(`/api/v1/investments/${stockId}/transactions`).set(user.auth).send({ type: 'buy', units: '10', price: '1700', tradeDate: '2025-03-10' });
    const sell = await api().post(`/api/v1/investments/${stockId}/transactions`).set(user.auth).send({ type: 'sell', units: '5', price: '1900', tradeDate: '2025-09-01', cashAccountId: demat.id });
    expect(sell.status).toBe(201);
    // avg cost = 32020 / 20 = 1601; cost of 5 = 8005; proceeds = 9500; gain = 1495
    expect(sell.body.data).toMatchObject({ units: '15', investedAmount: '24015.00', realizedGain: '1495.00' });
    const tooMany = await api().post(`/api/v1/investments/${stockId}/transactions`).set(user.auth).send({ type: 'sell', units: '50', price: '1900' });
    expect(tooMany.status).toBe(422);
    const div = await api().post(`/api/v1/investments/${stockId}/transactions`).set(user.auth).send({ type: 'dividend', amount: '300', cashAccountId: demat.id, tradeDate: '2025-10-01' });
    expect(div.body.data.incomeReceived).toBe('300.00');
  });

  it('labels manual prices and values deposits from their interest terms', async () => {
    const priced = await api().post(`/api/v1/investments/${stockId}/price`).set(user.auth).send({ price: '1800', asOf: '2026-01-02' });
    expect(priced.body.data).toMatchObject({ currentValue: '27000.00', unrealizedGain: '2985.00', valuationLabel: 'Manually entered' });
    const fd = await api()
      .post('/api/v1/investments')
      .set(user.auth)
      .send({ instrumentType: 'fixed_deposit', name: 'SBI FD 2y', interestRate: '7', compoundingPerYear: 4, startDate: '2025-01-01', maturityDate: '2027-01-01', initial: { amount: '100000', tradeDate: '2025-01-01' } });
    expect(fd.body.data.valuationSource).toBe('calculated');
    expect(Number(fd.body.data.currentValue)).toBeGreaterThan(100000);
    expect(fd.body.data.valuationLabel).toBe('Calculated from interest terms');
  });

  it('summarises the portfolio with allocation and disclosure', async () => {
    await api().post('/api/v1/investments').set(user.auth).send({ instrumentType: 'mutual_fund', name: 'Parag Parikh Flexi Cap', schemeCode: '122639', initial: { units: '100.123', price: '70', tradeDate: '2025-06-01' } });
    const res = await api().get('/api/v1/investments/portfolio').set(user.auth);
    const p = res.body.data;
    expect(p.totals.holdings).toBe(3);
    expect(p.allocation.map((a: { instrumentType: string }) => a.instrumentType)).toEqual(expect.arrayContaining(['stock', 'fixed_deposit', 'mutual_fund']));
    expect(p.totals.realizedGain).toBe('1795.00');
    expect(p.totals.xirrPercent).not.toBeNull();
    expect(p.dataSources.map((d: { source: string }) => d.source)).toEqual(expect.arrayContaining(['manual', 'calculated']));
    expect(p.disclaimer).toMatch(/not live market prices/);
    expect((await api().delete(`/api/v1/investments/${stockId}`).set(user.auth)).status).toBe(409);
  });
});
