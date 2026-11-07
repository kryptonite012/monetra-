import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from '../../src/db/seed';
import { api } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('demo seed', () => {
  afterAll(resetDatabase);

  it('creates a complete, consistent demo workspace and is re-runnable', async () => {
    await seedDemo();
    const { userId } = await seedDemo(); // second run replaces the first
    expect(await db('users').where({ email: DEMO_EMAIL })).toHaveLength(1);
    const counts = Object.fromEntries(
      await Promise.all(
        ['accounts', 'transactions', 'income_records', 'expense_records', 'budgets', 'savings_goals', 'loans', 'investments', 'assets', 'bills', 'subscriptions', 'net_worth_snapshots'].map(async (t) => {
          const [{ c }] = await db(t).where({ user_id: userId }).count({ c: '*' });
          return [t, Number(c)];
        }),
      ),
    );
    expect(counts.transactions).toBeGreaterThan(200);
    expect(counts.investments).toBe(5);
    expect(counts.net_worth_snapshots).toBeGreaterThanOrEqual(10);

    const login = await api().post('/api/v1/auth/login').send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const dash = await api().get('/api/v1/dashboard').set(auth);
    expect(Number(dash.body.data.netWorth.value)).toBeGreaterThan(0);
    const accounts = await api().get('/api/v1/accounts').set(auth);
    const cash = accounts.body.data.find((a: { type: string }) => a.type === 'cash');
    expect(Number(cash.balance)).toBeGreaterThan(0);
  }, 120_000);
});

describe('demo seed realism', () => {
  afterAll(resetDatabase);

  it('leaves no overdue EMIs and no recurring payments flagged as unusual', async () => {
    const { userId } = await seedDemo();
    const overdue = await db('loan_installments as i')
      .join('loans as l', 'l.id', 'i.loan_id')
      .where({ 'i.user_id': userId, 'i.status': 'due', 'l.status': 'active' })
      .where('i.due_date', '<', db.raw('CURRENT_DATE'))
      .count({ c: '*' });
    expect(Number(overdue[0].c)).toBe(0);
    const flagged = await db('notifications').where({ user_id: userId, type: 'unusual_spending' }).pluck('title');
    expect(flagged.join(' ')).not.toMatch(/32,000/);
  }, 120_000);
});
