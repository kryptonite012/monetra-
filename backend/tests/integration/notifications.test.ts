import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { testOutbox } from '../../src/lib/mailer';
import { checkBudgetAlerts } from '../../src/modules/notifications/alerts';
import { notify } from '../../src/modules/notifications/notifications.service';
import { api, createUser, STRONG_PASSWORD, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { categoryId, createAccount } from '../helpers/fixtures';

describe('notifications', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
  });
  afterAll(resetDatabase);
  beforeEach(() => {
    testOutbox.length = 0;
  });

  it('dedupes, respects preferences and emails security alerts by default', async () => {
    await notify(user.id, { type: 'bill_due', title: 'Rent due', body: 'Pay rent', dedupeKey: 'bill:x:2026-01' });
    expect(await notify(user.id, { type: 'bill_due', title: 'Rent due', body: 'Pay rent', dedupeKey: 'bill:x:2026-01' })).toBeNull();
    await api().patch('/api/v1/me/preferences').set(user.auth).send({ inAppNotifications: { goalMilestone: false } });
    expect(await notify(user.id, { type: 'goal_milestone', title: 'x', body: 'y' })).toBeNull();
    await notify(user.id, { type: 'security_alert', title: 'Alert', body: 'Something happened' });
    expect(testOutbox.some((m) => m.subject.includes('Alert'))).toBe(true);
  });

  it('lists, counts and marks notifications read', async () => {
    const list = await api().get('/api/v1/notifications').set(user.auth);
    expect(list.body.meta.unread).toBeGreaterThanOrEqual(2);
    const first = list.body.data[0];
    await api().patch(`/api/v1/notifications/${first.id}/read`).set(user.auth);
    const unread = await api().get('/api/v1/notifications/unread-count').set(user.auth);
    expect(unread.body.data.unread).toBe(list.body.meta.unread - 1);
    await api().post('/api/v1/notifications/read-all').set(user.auth);
    expect((await api().get('/api/v1/notifications?unread=true').set(user.auth)).body.data).toHaveLength(0);
  });

  it('raises budget alerts once per threshold', async () => {
    const bank = await createAccount(user, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    await api().post('/api/v1/budgets').set(user.auth).send({ month: '2026-03', categories: [{ categoryId: await categoryId('food.groceries'), limitAmount: '1000', alertThresholdPct: 80 }] });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '850', description: 'BigBasket order', occurredOn: '2026-03-03' });
    expect(await checkBudgetAlerts(user.id, '2026-03-03')).toBeGreaterThanOrEqual(0);
    expect(await checkBudgetAlerts(user.id, '2026-03-03')).toBe(0);
    const alerts = await db('notifications').where({ user_id: user.id, type: 'budget_threshold' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/Groceries budget at 85%/);
  });

  it('alerts on account lockout and new-device sign-in', async () => {
    const other = await createUser();
    await api().post('/api/v1/auth/login').set('User-Agent', 'Mozilla/5.0 (iPhone) Safari/605.1').send({ email: other.email, password: STRONG_PASSWORD });
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/login').send({ email: other.email, password: 'Wrong#Password1' });
    const titles = (await db('notifications').where({ user_id: other.id, type: 'security_alert' })).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['New sign-in to your account', 'Account temporarily locked']));
  });
});
