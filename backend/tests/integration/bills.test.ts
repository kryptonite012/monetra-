import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, categoryId, createAccount } from '../helpers/fixtures';

describe('bills and subscriptions', () => {
  let user: TestUser;
  let bank: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '50000', openingDate: '2025-01-01' });
  });
  afterAll(resetDatabase);

  it('pays a bill, posts the expense and advances the due date', async () => {
    const bill = await api().post('/api/v1/bills').set(user.auth).send({ name: 'Electricity', biller: 'BESCOM', billType: 'electricity', nextDueDate: '2026-01-31', defaultAccountId: bank.id, consumerNumber: 'KA-778812' });
    expect(bill.status).toBe(201);
    const paid = await api().post(`/api/v1/bills/${bill.body.data.id}/pay`).set(user.auth).send({ amount: '1842.50', paidOn: '2026-01-28' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.bill.nextDueDate).toBe('2026-02-28');
    expect(await balanceOf(user, bank.id)).toBe('48157.50');
    const history = await api().get(`/api/v1/bills/${bill.body.data.id}/payments`).set(user.auth);
    expect(history.body.data[0]).toMatchObject({ amount: '1842.50', periodDueDate: '2026-01-31' });
    const txns = await api().get('/api/v1/transactions?search=BESCOM').set(user.auth);
    expect(txns.body.data[0]).toMatchObject({ kind: 'bill_payment', categoryId: await categoryId('utilities.electricity') });
  });

  it('requires an amount for fixed bills and a card account for card bills', async () => {
    expect((await api().post('/api/v1/bills').set(user.auth).send({ name: 'Rent', billType: 'rent', amountType: 'fixed', nextDueDate: '2026-02-05' })).status).toBe(422);
    const card = await createAccount(user, { name: 'HDFC Card', type: 'credit_card', openingBalance: '-9000' });
    const cardBill = await api().post('/api/v1/bills').set(user.auth).send({ name: 'HDFC Card bill', billType: 'credit_card', nextDueDate: '2026-02-10', defaultAccountId: bank.id });
    expect((await api().post(`/api/v1/bills/${cardBill.body.data.id}/pay`).set(user.auth).send({ amount: '9000' })).status).toBe(422);
    const ok = await api().post(`/api/v1/bills/${cardBill.body.data.id}/pay`).set(user.auth).send({ amount: '9000', cardAccountId: card.id });
    expect(ok.status).toBe(200);
    expect(await balanceOf(user, card.id)).toBe('0.00');
  });

  it('tracks subscriptions, renewals and possibly unused services', async () => {
    const netflix = await api().post('/api/v1/subscriptions').set(user.auth).send({ name: 'Netflix', provider: 'Netflix', plan: 'Standard', amount: '499', nextRenewalDate: addDays(todayIn(), 2), startDate: '2025-01-01', defaultAccountId: bank.id });
    await api().post('/api/v1/subscriptions').set(user.auth).send({ name: 'Prime', amount: '1499', billingCycle: 'yearly', nextRenewalDate: addDays(todayIn(), 100), startDate: '2025-01-01', lastUsedOn: todayIn() });
    expect(netflix.body.data).toMatchObject({ monthlyEquivalent: '499.00', dueSoon: true });
    const summary = await api().get('/api/v1/subscriptions/summary').set(user.auth);
    expect(summary.body.data).toMatchObject({ activeCount: 2, monthlyCost: '623.92' });
    expect(summary.body.data.possiblyUnused.map((u: { name: string }) => u.name)).toEqual(['Netflix']);
    const renewed = await api().post(`/api/v1/subscriptions/${netflix.body.data.id}/pay`).set(user.auth).send({});
    expect(renewed.body.data.subscription.nextRenewalDate > netflix.body.data.nextRenewalDate).toBe(true);
    const upcoming = await api().get('/api/v1/bills/upcoming?days=45').set(user.auth);
    expect(upcoming.body.data.items.some((i: { kind: string }) => i.kind === 'subscription')).toBe(true);
    const cancelled = await api().post(`/api/v1/subscriptions/${netflix.body.data.id}/cancel`).set(user.auth).send({});
    expect(cancelled.body.data.status).toBe('cancelled');
  });
});
