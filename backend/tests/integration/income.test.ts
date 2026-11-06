import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, categoryId, createAccount } from '../helpers/fixtures';

describe('income management', () => {
  let user: TestUser;
  let bank: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'ICICI Salary', type: 'salary', openingDate: '2025-04-01' });
  });
  afterAll(resetDatabase);

  it('records salary with TDS and credits the net amount', async () => {
    const res = await api()
      .post('/api/v1/income')
      .set(user.auth)
      .send({ accountId: bank.id, sourceType: 'salary', grossAmount: '120000', taxDeducted: '14500', otherDeductions: '1800', occurredOn: '2026-01-31', payerName: 'Acme Technologies', periodMonth: '2026-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ netAmount: '103700.00', categoryId: await categoryId('income.salary'), description: 'Salary from Acme Technologies', periodMonth: '2026-01-01' });
    expect(await balanceOf(user, bank.id)).toBe('103700.00');
    const bad = await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '100', taxDeducted: '150' });
    expect(bad.status).toBe(422);
  });

  it('corrects and deletes income through reversals', async () => {
    const created = await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'freelance', grossAmount: '25000', occurredOn: '2026-02-10', payerName: 'Studio X' });
    const id = created.body.data.id;
    const fixed = await api().put(`/api/v1/income/${id}`).set(user.auth).send({ grossAmount: '27500', taxDeducted: '2750', reason: 'Invoice revised' });
    expect(fixed.body.data).toMatchObject({ netAmount: '24750.00', id });
    expect(await balanceOf(user, bank.id)).toBe('128450.00');
    const del = await api().delete(`/api/v1/income/${id}`).set(user.auth).send({ reason: 'Client cancelled' });
    expect(del.status).toBe(204);
    expect(await balanceOf(user, bank.id)).toBe('103700.00');
    expect((await api().get(`/api/v1/income/${id}`).set(user.auth)).status).toBe(404);
  });

  it('builds monthly and source-wise income reports', async () => {
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'interest', grossAmount: '1300', occurredOn: '2026-02-28' });
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '120000', taxDeducted: '14500', otherDeductions: '1800', occurredOn: '2026-02-28' });
    const res = await api().get('/api/v1/income/summary?from=2026-01-01&to=2026-03-31').set(user.auth);
    expect(res.body.data.totals).toMatchObject({ gross: '241300.00', taxDeducted: '29000.00', net: '208700.00', averageMonthlyNet: '104350.00' });
    expect(res.body.data.bySource[0]).toMatchObject({ sourceType: 'salary', net: '207400.00' });
    expect(res.body.data.byMonth.map((m: { month: string }) => m.month)).toEqual(['2026-01', '2026-02']);
  });

  it('posts recurring income automatically when due', async () => {
    const rule = await api()
      .post('/api/v1/recurring-rules')
      .set(user.auth)
      .send({ kind: 'income', name: 'Flat rent', accountId: bank.id, amount: '18000', incomeSource: 'rental', description: 'Rent from tenant', frequency: 'monthly', startDate: '2026-01-05' });
    expect(rule.status).toBe(201);
    const run = await api().post('/api/v1/recurring-rules/run-due').set(user.auth);
    expect(run.body.data.posted).toBeGreaterThanOrEqual(3);
    const list = await api().get('/api/v1/income?sourceType=rental').set(user.auth);
    expect(list.body.meta.total).toBe(run.body.data.posted);
    const again = await api().post('/api/v1/recurring-rules/run-due').set(user.auth);
    expect(again.body.data.posted).toBe(0);
    const upcoming = await api().get('/api/v1/recurring-rules/upcoming?days=40').set(user.auth);
    expect(upcoming.body.data.items.length).toBeGreaterThanOrEqual(1);
  });
});
