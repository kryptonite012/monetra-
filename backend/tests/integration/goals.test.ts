import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

describe('savings goals', () => {
  let user: TestUser;
  let salary: { id: string };
  let savings: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    salary = await createAccount(user, { name: 'Salary', openingBalance: '100000', openingDate: '2025-01-01' });
    savings = await createAccount(user, { name: 'Savings', openingBalance: '0', openingDate: '2025-01-01' });
  });
  afterAll(resetDatabase);

  it('estimates completion from the monthly plan', async () => {
    const res = await api()
      .post('/api/v1/goals')
      .set(user.auth)
      .send({ name: 'Emergency fund', goalType: 'emergency', targetAmount: '300000', monthlyContribution: '25000', targetDate: addMonths(todayIn(), 24), initialAmount: '50000' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ savedAmount: '50000.00', remainingAmount: '250000.00', completionPercent: '16.67', onTrack: true });
    expect(res.body.data.estimatedCompletionDate).toBe(addMonths(todayIn(), 10));
    expect(res.body.data.estimateNote).toMatch(/estimate/i);
  });

  it('moves money between accounts when contributing and marks achievement', async () => {
    const goal = (await api().post('/api/v1/goals').set(user.auth).send({ name: 'Goa trip', goalType: 'vacation', targetAmount: '40000' })).body.data;
    const res = await api().post(`/api/v1/goals/${goal.id}/contributions`).set(user.auth).send({ amount: '30000', fromAccountId: salary.id, toAccountId: savings.id });
    expect(res.body.data.completionPercent).toBe('75.00');
    expect(await balanceOf(user, savings.id)).toBe('30000.00');
    const done = await api().post(`/api/v1/goals/${goal.id}/contributions`).set(user.auth).send({ amount: '10000' });
    expect(done.body.data.status).toBe('achieved');
    const tooMuch = await api().post(`/api/v1/goals/${goal.id}/contributions`).set(user.auth).send({ amount: '-50000' });
    expect(tooMuch.status).toBe(422);
    const withdraw = await api().post(`/api/v1/goals/${goal.id}/contributions`).set(user.auth).send({ amount: '-5000', fromAccountId: salary.id, toAccountId: savings.id });
    expect(withdraw.body.data).toMatchObject({ status: 'active', savedAmount: '35000.00' });
    expect(await balanceOf(user, savings.id)).toBe('25000.00');
  });

  it('flags goals that are off track and computes the required contribution', async () => {
    const res = await api().post('/api/v1/goals').set(user.auth).send({ name: 'New laptop', goalType: 'gadget', targetAmount: '120000', targetDate: addMonths(todayIn(), 6), monthlyContribution: '5000' });
    expect(res.body.data.onTrack).toBe(false);
    expect(Number(res.body.data.requiredMonthlyContribution)).toBeGreaterThan(19000);
    const list = await api().get('/api/v1/goals?status=active').set(user.auth);
    expect(list.body.data.length).toBe(3);
  });
});
