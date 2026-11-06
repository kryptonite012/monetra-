import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('accounts', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
  });
  afterAll(resetDatabase);

  it('creates bank, cash and card accounts with computed balances', async () => {
    const bank = await api()
      .post('/api/v1/accounts')
      .set(user.auth)
      .send({ name: 'SBI Savings', nickname: 'Main', type: 'savings', institutionName: 'State Bank of India', accountNumberLast4: '4321', ifsc: 'sbin0001234', openingBalance: '52000.50' });
    expect(bank.status).toBe(201);
    expect(bank.body.data).toMatchObject({ balance: '52000.50', ifsc: 'SBIN0001234', dataSourceLabel: 'Manually tracked', isLiability: false });

    await api().post('/api/v1/accounts').set(user.auth).send({ name: 'Cash in hand', type: 'cash', openingBalance: 3500 });
    const card = await api().post('/api/v1/accounts').set(user.auth).send({ name: 'ICICI Amazon Pay', type: 'credit_card', openingBalance: '-12000', creditLimit: '100000' });
    expect(card.body.data).toMatchObject({ outstanding: '12000.00', availableCredit: '88000.00', utilizationPercent: '12', isLiability: true });

    const summary = await api().get('/api/v1/accounts/summary').set(user.auth);
    expect(summary.body.data).toMatchObject({ accountCount: 3, totalAvailableBalance: '55500.50', creditCardOutstanding: '12000.00', netAccountBalance: '43500.50' });
  });

  it('rejects full account numbers and invalid credit limits', async () => {
    const full = await api().post('/api/v1/accounts').set(user.auth).send({ name: 'HDFC 50100234567891', type: 'savings' });
    expect(full.status).toBe(422);
    const limit = await api().post('/api/v1/accounts').set(user.auth).send({ name: 'Savings X', type: 'savings', creditLimit: '5000' });
    expect(limit.status).toBe(422);
  });

  it('protects opening balances once history exists and supports closing', async () => {
    const acct = (await api().post('/api/v1/accounts').set(user.auth).send({ name: 'Paytm Wallet', type: 'wallet', openingBalance: '500' })).body.data;
    await db('transactions').insert({ user_id: user.id, account_id: acct.id, direction: 'debit', amount: '500', kind: 'expense', occurred_on: '2026-01-05', description: 'Recharge' });
    const edit = await api().patch(`/api/v1/accounts/${acct.id}`).set(user.auth).send({ openingBalance: '900' });
    expect(edit.status).toBe(409);
    const rename = await api().patch(`/api/v1/accounts/${acct.id}`).set(user.auth).send({ nickname: 'Paytm' });
    expect(rename.body.data.nickname).toBe('Paytm');

    const asOf = await api().get(`/api/v1/accounts/${acct.id}/balance?asOf=2026-01-04`).set(user.auth);
    expect(asOf.body.data.balance).toBe('500.00');

    const del = await api().delete(`/api/v1/accounts/${acct.id}`).set(user.auth);
    expect(del.status).toBe(409);
    const close = await api().post(`/api/v1/accounts/${acct.id}/close`).set(user.auth).send({});
    expect(close.body.data).toMatchObject({ isActive: false, closingBalance: '0.0000' });
    const listed = await api().get('/api/v1/accounts').set(user.auth);
    expect(listed.body.data.some((a: { id: string }) => a.id === acct.id)).toBe(false);
  });

  it('requires confirmation to close an account with money in it', async () => {
    const acct = (await api().post('/api/v1/accounts').set(user.auth).send({ name: 'Old FD Sweep', type: 'current', openingBalance: '10' })).body.data;
    expect((await api().post(`/api/v1/accounts/${acct.id}/close`).set(user.auth).send({})).status).toBe(409);
    expect((await api().post(`/api/v1/accounts/${acct.id}/close`).set(user.auth).send({ force: true })).status).toBe(200);
  });

  it("hides other users' accounts", async () => {
    const other = await createUser();
    const mine = (await api().get('/api/v1/accounts').set(user.auth)).body.data[0];
    expect((await api().get(`/api/v1/accounts/${mine.id}`).set(other.auth)).status).toBe(404);
  });
});
