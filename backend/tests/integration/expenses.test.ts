import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, categoryId, createAccount } from '../helpers/fixtures';

describe('expense management', () => {
  let user: TestUser;
  let bank: { id: string };
  let card: { id: string };
  let upi: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'HDFC', openingBalance: '100000', openingDate: '2026-01-01' });
    card = await createAccount(user, { name: 'Amex', type: 'credit_card', creditLimit: '200000', openingDate: '2026-01-01' });
    upi = (await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'upi', label: 'PhonePe', upiVpa: 'me@ybl' })).body.data.id;
    const add = (body: Record<string, unknown>) => api().post('/api/v1/expenses').set(user.auth).send(body);
    await add({ accountId: bank.id, amount: '650', occurredOn: '2026-03-02', description: 'Swiggy dinner', paymentMethodId: upi, merchantName: 'Swiggy' });
    await add({ accountId: bank.id, amount: '2100', occurredOn: '2026-03-03', description: 'BigBasket monthly', paymentMethodId: upi, merchantName: 'BigBasket' });
    await add({ accountId: card.id, amount: '15999', occurredOn: '2026-03-10', description: 'Headphones', merchantName: 'Croma', categoryId: await categoryId('shopping.electronics'), gstAmount: '2440.53' });
    await add({ accountId: bank.id, amount: '480', occurredOn: '2026-03-10', description: 'Uber to airport', paymentMethodId: upi, merchantName: 'Uber' });
    await add({ accountId: bank.id, amount: '1200', occurredOn: '2026-02-15', description: 'Zomato party order', merchantName: 'Zomato' });
  });
  afterAll(resetDatabase);

  it('records expenses with merchants and automatic categories', async () => {
    const list = await api().get('/api/v1/expenses?from=2026-03-01&to=2026-03-31').set(user.auth);
    expect(list.body.meta.total).toBe(4);
    const grocery = list.body.data.find((e: { description: string }) => e.description === 'BigBasket monthly');
    expect(grocery).toMatchObject({ categoryName: 'Groceries', merchantName: 'BigBasket', paymentMethodType: 'upi', amount: '2100.00' });
    expect(await balanceOf(user, bank.id)).toBe('95570.00');
  });

  it('edits and deletes via reversals while keeping the record id', async () => {
    const list = await api().get('/api/v1/expenses?search=uber').set(user.auth);
    const id = list.body.data[0].id;
    const edited = await api().put(`/api/v1/expenses/${id}`).set(user.auth).send({ amount: '520', reason: 'Added tip' });
    expect(edited.body.data).toMatchObject({ id, amount: '520.00', categoryName: 'Cab & Auto' });
    expect(await balanceOf(user, bank.id)).toBe('95530.00');
    const del = await api().delete(`/api/v1/expenses/${id}`).set(user.auth).send({});
    expect(del.status).toBe(204);
    expect(await balanceOf(user, bank.id)).toBe('96050.00');
  });

  it('produces spending analytics with breakdowns and comparison', async () => {
    const res = await api().get('/api/v1/expenses/analytics?from=2026-03-01&to=2026-03-31&granularity=day').set(user.auth);
    const a = res.body.data;
    expect(a.totals).toMatchObject({ total: '18749.00', count: 3, largestExpense: '15999.00' });
    expect(a.totals.highestSpendDay).toEqual({ date: '2026-03-10', total: '15999.00' });
    expect(a.byCategory[0]).toMatchObject({ name: 'Shopping', total: '15999.00' });
    expect(a.byCategory.find((c: { name: string }) => c.name === 'Food & Dining').total).toBe('2750.00');
    expect(a.byPaymentType.find((p: { paymentType: string }) => p.paymentType === 'upi').total).toBe('2750.00');
    expect(a.comparison.previousPeriod.total).toBe('1200.00');
    expect(a.sumCheck).toBe(a.totals.total);
    const monthly = await api().get('/api/v1/expenses/analytics?from=2026-01-01&to=2026-03-31&granularity=month').set(user.auth);
    expect(monthly.body.data.series.map((s: { period: string }) => s.period)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('posts recurring expenses through the scheduler', async () => {
    await api()
      .post('/api/v1/recurring-rules')
      .set(user.auth)
      .send({ kind: 'expense', name: 'Netflix', accountId: card.id, amount: '649', description: 'Netflix subscription', merchantName: 'Netflix', frequency: 'monthly', startDate: '2026-03-20', endDate: '2026-04-20' });
    const run = await api().post('/api/v1/recurring-rules/run-due').set(user.auth);
    expect(run.body.data.posted).toBe(2);
    const list = await api().get('/api/v1/expenses?search=netflix').set(user.auth);
    expect(list.body.data[0].categoryName).toBe('OTT Subscriptions');
    const rules = await api().get('/api/v1/recurring-rules').set(user.auth);
    expect(rules.body.data[0].isActive).toBe(false);
  });
});
