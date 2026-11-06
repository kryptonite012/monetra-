import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

describe('reconciliation and statements', () => {
  let user: TestUser;
  let bank: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Axis Savings', openingBalance: '10000', openingDate: '2026-01-01' });
    const post = (amount: string, occurredOn: string, kind: string, description: string) =>
      api().post('/api/v1/transactions').set(user.auth).send({ accountId: bank.id, kind, amount, occurredOn, description });
    await post('2500', '2026-02-02', 'expense', 'Rent share');
    await post('60000', '2026-02-01', 'income', 'Salary Feb');
    await post('1200', '2026-02-15', 'expense', 'Groceries');
    await post('300', '2026-03-01', 'expense', 'Movie');
  });
  afterAll(resetDatabase);

  it('produces a statement with running balances', async () => {
    const res = await api().get(`/api/v1/accounts/${bank.id}/statement?from=2026-02-01&to=2026-02-28`).set(user.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ openingBalance: '10000.00', totalCredits: '60000.00', totalDebits: '3700.00', closingBalance: '66300.00' });
    expect(res.body.data.entries.map((e: { runningBalance: string }) => e.runningBalance)).toEqual(['70000.00', '67500.00', '66300.00']);
  });

  it('reports a mismatch without changing history', async () => {
    const res = await api().post(`/api/v1/accounts/${bank.id}/reconcile`).set(user.auth).send({ asOfDate: '2026-02-28', statementBalance: '66250' });
    expect(res.body.data).toMatchObject({ status: 'mismatch', difference: '-50.00', reconciled: false });
    expect(await balanceOf(user, bank.id)).toBe('66000.00');
  });

  it('posts an auditable adjustment when asked', async () => {
    const res = await api().post(`/api/v1/accounts/${bank.id}/reconcile`).set(user.auth).send({ asOfDate: '2026-02-28', statementBalance: '66250', postAdjustment: true, note: 'Bank charges not recorded' });
    expect(res.body.data).toMatchObject({ status: 'adjusted', reconciled: true });
    expect(res.body.data.adjustmentTransactionId).toBeTruthy();
    expect(await balanceOf(user, bank.id)).toBe('65950.00');
    const matched = await api().post(`/api/v1/accounts/${bank.id}/reconcile`).set(user.auth).send({ asOfDate: '2026-02-28', statementBalance: '66250' });
    expect(matched.body.data.status).toBe('matched');
    const history = await api().get(`/api/v1/accounts/${bank.id}/reconciliations`).set(user.auth);
    expect(history.body.data).toHaveLength(1);
  });
});
