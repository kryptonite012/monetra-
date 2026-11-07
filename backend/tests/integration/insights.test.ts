import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, monthStart, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { createAccount } from '../helpers/fixtures';

describe('assistant insights and forecasts', () => {
  let user: TestUser;
  const today = todayIn();

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    const bank = await createAccount(user, { name: 'Bank', openingBalance: '200000', openingDate: '2024-01-01' });
    // Six months of history: salary, rising grocery spend and a steady gym charge.
    for (let m = 6; m >= 1; m--) {
      const d = monthStart(addMonths(today, -m));
      await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '90000', occurredOn: d });
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: String(20000 + (6 - m) * 1000), description: 'BigBasket monthly', merchantName: 'BigBasket', occurredOn: addDays(d, 2) });
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '1500', description: 'Gym membership', merchantName: 'FitZone Gym', occurredOn: addDays(d, 4) });
    }
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '90000', occurredOn: monthStart(today) });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '45000', description: 'Croma laptop', occurredOn: today });
  });
  afterAll(resetDatabase);

  it('produces explainable insights', async () => {
    const res = await api().get('/api/v1/assistant/insights').set(user.auth);
    const types = res.body.data.insights.map((i: { type: string }) => i.type);
    expect(types).toEqual(expect.arrayContaining(['top_category', 'savings_rate', 'anomaly', 'recurring_charge', 'forecast']));
    const recurring = res.body.data.insights.find((i: { type: string }) => i.type === 'recurring_charge');
    expect(recurring.title).toContain('FitZone Gym');
    const forecast = res.body.data.insights.find((i: { type: string }) => i.type === 'forecast');
    expect(forecast.assumptions.join(' ')).toMatch(/not guarantees/);
  });

  it('forecasts spending with a range and savings with stated assumptions', async () => {
    const res = await api().get('/api/v1/assistant/forecast?months=6').set(user.auth);
    const { expenditure, savings } = res.body.data;
    expect(expenditure.history).toHaveLength(6);
    expect(Number(expenditure.forecast[0].value)).toBeGreaterThan(Number(expenditure.history[0].expenses));
    expect(Number(expenditure.forecast[0].high)).toBeGreaterThanOrEqual(Number(expenditure.forecast[0].low));
    expect(savings.projection).toHaveLength(6);
    expect(savings.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.disclaimer).toMatch(/not guarantees/);
  });
});
