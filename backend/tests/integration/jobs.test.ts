import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { billReminders, emiReminders, netWorthSnapshots, retentionCleanup, runAllTasks, subscriptionReminders, unusualSpending } from '../../src/jobs/tasks';
import { runWithLock } from '../../src/jobs/scheduler';
import { addDays, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { createAccount } from '../helpers/fixtures';

describe('background jobs', () => {
  let user: TestUser;
  let bank: { id: string };
  const today = todayIn();

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '500000', openingDate: '2025-01-01' });
  });
  afterAll(resetDatabase);

  it('sends bill, subscription and EMI reminders exactly once', async () => {
    await api().post('/api/v1/bills').set(user.auth).send({ name: 'Water bill', billType: 'water', nextDueDate: addDays(today, 2), reminderDaysBefore: 3 });
    await api().post('/api/v1/subscriptions').set(user.auth).send({ name: 'Spotify', amount: '119', nextRenewalDate: addDays(today, 1) });
    await api().post('/api/v1/loans').set(user.auth).send({ name: 'Phone EMI', loanType: 'consumer_durable', lender: 'Bajaj Finserv', principal: '30000', interestRate: '0', tenureMonths: 6, startDate: addDays(today, -27), firstEmiDate: addDays(today, 3) });
    expect((await billReminders(today)).sent).toBe(1);
    expect((await billReminders(today)).sent).toBe(0);
    expect((await subscriptionReminders(today)).sent).toBe(1);
    expect((await emiReminders(today)).sent).toBe(1);
    const types = (await db('notifications').where({ user_id: user.id })).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['bill_due', 'subscription_renewal', 'emi_due']));
  });

  it('flags unusually large spending against the user baseline', async () => {
    for (let i = 10; i < 30; i++) {
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: String(400 + i), description: `Groceries ${i}`, occurredOn: addDays(today, -i), merchantName: 'DMart' });
    }
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '18500', description: 'Mystery electronics', occurredOn: today });
    const res = await unusualSpending(today);
    expect(res.raised).toBe(1);
    const alert = await db('notifications').where({ user_id: user.id, type: 'unusual_spending' }).first();
    expect(alert.title).toContain('18,500.00');
  });

  it('snapshots net worth, cleans up and runs under an advisory lock', async () => {
    expect((await netWorthSnapshots(today)).snapshots).toBeGreaterThanOrEqual(1);
    expect(await db('net_worth_snapshots').where({ user_id: user.id })).toHaveLength(1);
    expect(await retentionCleanup()).toMatchObject({ tokens: expect.any(Number) });
    const all = await runAllTasks(today);
    expect(Object.keys(all)).toEqual(expect.arrayContaining(['recurring', 'billReminders', 'unusualSpending', 'netWorthSnapshots']));
    expect(await runWithLock()).toBe(true);
  });
});

describe('anomaly detection precision', () => {
  afterAll(resetDatabase);

  it('does not flag recurring payments such as rent', async () => {
    await resetDatabase();
    const user = await createUser();
    const bank = await createAccount(user, { name: 'Bank', openingBalance: '900000', openingDate: '2025-01-01' });
    const today = todayIn();
    for (let i = 1; i <= 3; i++) {
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '32000', description: 'House rent', occurredOn: addDays(today, -30 * i - 5) });
    }
    for (let i = 35; i < 60; i++) {
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '450', description: `Snacks ${i}`, occurredOn: addDays(today, -i) });
    }
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '32000', description: 'House rent', occurredOn: today });
    expect((await unusualSpending(today)).raised).toBe(0);
  });
});
