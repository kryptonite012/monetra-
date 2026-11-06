import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

describe('assets, liabilities and net worth', () => {
  let user: TestUser;
  let bank: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '250000', openingDate: '2024-01-01' });
    await createAccount(user, { name: 'Card', type: 'credit_card', openingBalance: '-15000', creditLimit: '100000' });
    await api().post('/api/v1/investments').set(user.auth).send({ instrumentType: 'stock', name: 'TCS', initial: { units: '10', price: '4000', tradeDate: '2025-01-01' } });
    await api().post('/api/v1/loans').set(user.auth).send({ name: 'Bike', loanType: 'vehicle', lender: 'Bajaj', principal: '120000', interestRate: '0', tenureMonths: 12, startDate: '2025-01-01', paidInstallments: 6 });
  });
  afterAll(resetDatabase);

  it('maintains an asset register with gains', async () => {
    const flat = await api().post('/api/v1/assets').set(user.auth).send({ name: '2BHK Pune', assetType: 'real_estate', purchaseValue: '4500000', purchaseDate: '2020-05-01', currentValue: '6200000', valuationSource: 'appraisal' });
    expect(flat.body.data).toMatchObject({ gain: '1700000.00', gainPercent: '37.78' });
    const gold = await api().post('/api/v1/assets').set(user.auth).send({ name: 'Gold coins', assetType: 'gold', currentValue: '180000' });
    const revalued = await api().post(`/api/v1/assets/${gold.body.data.id}/revalue`).set(user.auth).send({ currentValue: '195000' });
    expect(revalued.body.data.currentValue).toBe('195000.00');
  });

  it('tracks other liabilities and repayments', async () => {
    const owed = await api().post('/api/v1/liabilities').set(user.auth).send({ name: 'Borrowed from Arjun', liabilityType: 'personal_borrowing', counterparty: 'Arjun', amountOutstanding: '20000' });
    const paid = await api().post(`/api/v1/liabilities/${owed.body.data.id}/payments`).set(user.auth).send({ amount: '5000', accountId: bank.id });
    expect(paid.body.data).toMatchObject({ amountOutstanding: '15000.00', status: 'open' });
    expect(await balanceOf(user, bank.id)).toBe('245000.00');
    const over = await api().post(`/api/v1/liabilities/${owed.body.data.id}/payments`).set(user.auth).send({ amount: '50000' });
    expect(over.status).toBe(422);
  });

  it('computes net worth from every module', async () => {
    const res = await api().get('/api/v1/net-worth').set(user.auth);
    // assets: 245000 bank + 40000 stocks + 6395000 property/gold; liabilities: 15000 card + 60000 loan + 15000 other
    expect(res.body.data).toMatchObject({ totalAssets: '6680000.00', totalLiabilities: '90000.00', netWorth: '6590000.00' });
    expect(res.body.data.liabilities).toEqual({ creditCardsAndOverdrafts: '15000.00', loans: '60000.00', other: '15000.00' });
    const snap = await api().post('/api/v1/net-worth/snapshot').set(user.auth);
    expect(snap.body.data.netWorth).toBe('6590000.00');
    const history = await api().get('/api/v1/net-worth/history').set(user.auth);
    expect(history.body.data.points.at(-1).netWorth).toBe('6590000.00');
  });
});
