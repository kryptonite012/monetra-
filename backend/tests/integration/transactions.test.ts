import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, categoryId, createAccount } from '../helpers/fixtures';

describe('transaction engine', () => {
  let user: TestUser;
  let bank: { id: string };
  let card: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'HDFC Savings', openingBalance: '50000' });
    card = await createAccount(user, { name: 'SBI Card', type: 'credit_card', creditLimit: '20000' });
  });
  afterAll(resetDatabase);

  it('posts expenses with automatic categorisation and updates balances', async () => {
    const res = await api()
      .post('/api/v1/transactions')
      .set(user.auth)
      .send({ accountId: bank.id, kind: 'expense', amount: '1249.75', occurredOn: '2026-04-03', description: 'Zepto order', reference: 'UPI412233445566', counterparty: 'zepto@ybl' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ direction: 'debit', amount: '1249.75', signedAmount: '-1249.75', categoryId: await categoryId('food.groceries') });
    expect(res.body.data.metadata.autoCategory.source).toBe('keyword');
    expect(await balanceOf(user, bank.id)).toBe('48750.25');
  });

  it('rejects duplicate payment references and enforces direction by kind', async () => {
    const dup = await api()
      .post('/api/v1/transactions')
      .set(user.auth)
      .send({ accountId: bank.id, kind: 'expense', amount: '10', occurredOn: '2026-04-03', description: 'again', reference: 'UPI412233445566' });
    expect(dup.status).toBe(409);
    const wrong = await api().post('/api/v1/transactions').set(user.auth).send({ accountId: bank.id, kind: 'income', direction: 'debit', amount: '10', description: 'bad' });
    expect(wrong.status).toBe(422);
    const wrongCat = await api()
      .post('/api/v1/transactions')
      .set(user.auth)
      .send({ accountId: bank.id, kind: 'expense', amount: '10', description: 'x', categoryId: await categoryId('income.salary') });
    expect(wrongCat.status).toBe(422);
  });

  it('transfers between accounts as a balanced pair (card bill payment)', async () => {
    await api().post('/api/v1/transactions').set(user.auth).send({ accountId: card.id, kind: 'expense', amount: '5000', occurredOn: '2026-04-05', description: 'Croma TV' });
    const transfer = await api().post('/api/v1/transactions/transfer').set(user.auth).send({ fromAccountId: bank.id, toAccountId: card.id, amount: '5000', occurredOn: '2026-04-20' });
    expect(transfer.status).toBe(201);
    expect(transfer.body.data.debit.categoryId).toBe(await categoryId('transfer.card_payment'));
    expect(await balanceOf(user, card.id)).toBe('0.00');
    expect(await balanceOf(user, bank.id)).toBe('43750.25');
  });

  it('reverses transfers as a pair and keeps history', async () => {
    const t = await api().post('/api/v1/transactions/transfer').set(user.auth).send({ fromAccountId: bank.id, toAccountId: card.id, amount: '750', occurredOn: '2026-04-21' });
    const rev = await api().post(`/api/v1/transactions/${t.body.data.credit.id}/reverse`).set(user.auth).send({ reason: 'Paid twice by mistake' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.reversals).toHaveLength(2);
    expect(await balanceOf(user, bank.id)).toBe('43750.25');
    const again = await api().post(`/api/v1/transactions/${t.body.data.debit.id}/reverse`).set(user.auth).send({ reason: 'again' });
    expect(again.status).toBe(409);
    const detail = await api().get(`/api/v1/transactions/${t.body.data.debit.id}`).set(user.auth);
    expect(detail.body.data.status).toBe('reversed');
    expect(detail.body.data.related.length).toBeGreaterThanOrEqual(2);
  });

  it('corrects an amount by reversing and re-posting', async () => {
    const orig = await api().post('/api/v1/transactions').set(user.auth).send({ accountId: bank.id, kind: 'expense', amount: '999', occurredOn: '2026-04-10', description: 'Electricity BESCOM' });
    const fixed = await api().post(`/api/v1/transactions/${orig.body.data.id}/correct`).set(user.auth).send({ amount: '1099', reason: 'Typo in amount' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.replacement).toMatchObject({ amount: '1099.00', supersedesId: orig.body.data.id, categoryId: orig.body.data.categoryId });
    expect(await balanceOf(user, bank.id)).toBe('42651.25');
  });

  it('annotates without touching money and lists with filters and totals', async () => {
    const list = await api().get('/api/v1/transactions?from=2026-04-01&to=2026-04-30&kind=expense').set(user.auth);
    expect(list.status).toBe(200);
    expect(list.body.meta.totals.debits).toBe('7348.75');
    const target = list.body.data[0];
    const patched = await api().patch(`/api/v1/transactions/${target.id}`).set(user.auth).send({ notes: 'reimbursable', tags: ['work'] });
    expect(patched.body.data).toMatchObject({ notes: 'reimbursable', tags: ['work'], amount: target.amount });
    const byTag = await api().get('/api/v1/transactions?tag=work').set(user.auth);
    expect(byTag.body.data).toHaveLength(1);
    const search = await api().get('/api/v1/transactions?search=zepto').set(user.auth);
    expect(search.body.data).toHaveLength(1);
    const withReversed = await api().get('/api/v1/transactions?includeReversed=true').set(user.auth);
    expect(withReversed.body.meta.total).toBeGreaterThan(list.body.meta.total);
  });

  it('blocks postings to closed accounts and isolates users', async () => {
    const wallet = await createAccount(user, { name: 'Old wallet', type: 'wallet' });
    await api().post(`/api/v1/accounts/${wallet.id}/close`).set(user.auth).send({});
    const res = await api().post('/api/v1/transactions').set(user.auth).send({ accountId: wallet.id, kind: 'expense', amount: '1', description: 'x' });
    expect(res.status).toBe(409);
    const other = await createUser();
    const steal = await api().post('/api/v1/transactions').set(other.auth).send({ accountId: bank.id, kind: 'expense', amount: '1', description: 'x' });
    expect(steal.status).toBe(422);
  });
});
