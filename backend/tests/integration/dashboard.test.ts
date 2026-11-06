import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, monthStart, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { createAccount } from '../helpers/fixtures';

describe('dashboard', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    const bank = await createAccount(user, { name: 'Bank', openingBalance: '100000', openingDate: '2024-01-01' });
    const today = todayIn();
    const day = monthStart(today);
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '80000', occurredOn: day });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '12000', description: 'House rent', occurredOn: day });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '8000', description: 'BigBasket groceries', occurredOn: day });
    await api().post('/api/v1/bills').set(user.auth).send({ name: 'Internet', billType: 'internet', amountType: 'fixed', expectedAmount: '799', nextDueDate: addDays(today, 5) });
  });
  afterAll(resetDatabase);

  it('returns the command-centre summary for the month', async () => {
    const res = await api().get('/api/v1/dashboard?period=month').set(user.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.balances.totalAvailableBalance).toBe('160000.00');
    expect(d.totals).toMatchObject({ income: '80000.00', expenses: '20000.00', netCashFlow: '60000.00', savingsRatePercent: '75.00' });
    expect(d.netWorth.value).toBe('160000.00');
    expect(d.upcomingBills[0]).toMatchObject({ name: 'Internet', amount: '799.00' });
    expect(d.recentTransactions).toHaveLength(3);
    expect(d.charts.cashflow).toHaveLength(6);
    expect(d.charts.cashflow.at(-1)).toMatchObject({ income: '80000.00', expenses: '20000.00' });
    expect(d.charts.spendingByCategory.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Housing', 'Food & Dining']));
    expect(d.healthScore.score).toBeGreaterThan(0);
    expect(d.healthScore.components).toHaveLength(6);
  });

  it('serves yearly cash flow and the health score separately', async () => {
    const cf = await api().get('/api/v1/dashboard/cashflow?months=12').set(user.auth);
    expect(cf.body.data).toHaveLength(12);
    const hs = await api().get('/api/v1/dashboard/health-score').set(user.auth);
    expect(hs.body.data.methodology).toMatch(/educational/);
  });
});
