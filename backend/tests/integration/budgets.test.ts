import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { categoryId, createAccount } from '../helpers/fixtures';

describe('budgets', () => {
  let user: TestUser;
  let bank: { id: string };
  let budgetId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '200000', openingDate: '2026-01-01' });
    const add = (amount: string, description: string, slug: string, occurredOn = '2026-02-10') =>
      api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount, description, occurredOn, categoryId: null, ...(slug ? {} : {}) }).then(async (res) => {
        if (slug) await api().patch(`/api/v1/transactions/${res.body.data.transactionId}`).set(user.auth).send({ categoryId: await categoryId(slug) });
        return res;
      });
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '90000', occurredOn: '2026-02-01' });
    await add('4200', 'BigBasket', 'food.groceries');
    await add('1900', 'Swiggy', 'food.delivery');
    await add('2600', 'Zomato', 'food.delivery', '2026-02-20');
    await add('3000', 'Myntra shirts', 'shopping.clothing');
    await add('25000', 'Rent', 'housing.rent');
  });
  afterAll(resetDatabase);

  it('computes utilisation with sub-category roll-up and alerts', async () => {
    const res = await api()
      .post('/api/v1/budgets')
      .set(user.auth)
      .send({
        month: '2026-02',
        savingsTarget: '40000',
        categories: [
          { categoryId: await categoryId('food'), limitAmount: '8000', alertThresholdPct: 80 },
          { categoryId: await categoryId('shopping.clothing'), limitAmount: '5000' },
          { categoryId: await categoryId('food.delivery'), limitAmount: '4000' },
        ],
      });
    expect(res.status).toBe(201);
    budgetId = res.body.data.id;
    const food = res.body.data.categories.find((c: { name: string }) => c.name === 'Food & Dining');
    expect(food).toMatchObject({ spent: '8700.00', status: 'exceeded', remaining: '-700.00' });
    const delivery = res.body.data.categories.find((c: { name: string }) => c.name === 'Food Delivery');
    expect(delivery).toMatchObject({ spent: '4500.00', status: 'exceeded' });
    const clothing = res.body.data.categories.find((c: { name: string }) => c.name === 'Clothing & Footwear');
    expect(clothing).toMatchObject({ utilizationPercent: '60.00', status: 'ok' });
    expect(res.body.data.totals).toMatchObject({ spent: '36700.00', unbudgetedSpend: '25000.00', income: '90000.00', actualSavings: '53300.00', savingsTargetMet: true });
    expect(res.body.data.alerts.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['Food & Dining', 'Food Delivery']));
  });

  it('rejects duplicate months and income categories', async () => {
    expect((await api().post('/api/v1/budgets').set(user.auth).send({ month: '2026-02' })).status).toBe(409);
    const bad = await api().post('/api/v1/budgets').set(user.auth).send({ month: '2026-05', categories: [{ categoryId: await categoryId('income.salary'), limitAmount: '10' }] });
    expect(bad.status).toBe(422);
  });

  it('copies budgets, compares months and reports history', async () => {
    const copy = await api().post(`/api/v1/budgets/${budgetId}/copy`).set(user.auth).send({ toMonth: '2026-03' });
    expect(copy.status).toBe(201);
    expect(copy.body.data.categories).toHaveLength(3);
    const byMonth = await api().get('/api/v1/budgets?month=2026-03').set(user.auth);
    expect(byMonth.body.data.totals.spent).toBe('0.00');
    const cmp = await api().get('/api/v1/budgets/compare?a=2026-02&b=2026-03').set(user.auth);
    expect(cmp.body.data.categories.find((c: { name: string }) => c.name === 'Food & Dining').spentChange).toBe('-8700.00');
    const history = await api().get('/api/v1/budgets/history?months=6').set(user.auth);
    expect(history.body.data.map((h: { month: string }) => h.month)).toEqual(['2026-02', '2026-03']);
    expect(history.body.data[0].categoriesOverBudget).toBe(2);
  });
});
