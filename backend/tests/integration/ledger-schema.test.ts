import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('immutable ledger (database level)', () => {
  let user: TestUser;
  let accountId: string;
  let txnId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    const [acct] = await db('accounts').insert({ user_id: user.id, name: 'Wallet', type: 'cash', opening_balance: '1000' }).returning('id');
    accountId = acct.id;
    const [txn] = await db('transactions')
      .insert({ user_id: user.id, account_id: accountId, direction: 'debit', amount: '250.50', kind: 'expense', occurred_on: '2026-03-01', description: 'Groceries' })
      .returning('id');
    txnId = txn.id;
  });
  afterAll(resetDatabase);

  it('computes balances from opening balance and signed entries', async () => {
    const row = await db('account_current_balances').where({ account_id: accountId }).first();
    expect(row.balance).toBe('749.5000');
  });

  it('blocks edits to financial fields but allows annotations', async () => {
    await expect(db('transactions').where({ id: txnId }).update({ amount: '1' })).rejects.toThrow(/immutable/);
    await expect(db('transactions').where({ id: txnId }).update({ occurred_on: '2026-03-02' })).rejects.toThrow(/immutable/);
    await db('transactions').where({ id: txnId }).update({ notes: 'weekly shop', tags: ['family'] });
  });

  it('blocks deletes unless the sanctioned purge flag is set', async () => {
    await expect(db('transactions').where({ id: txnId }).delete()).rejects.toThrow(/cannot be deleted/);
  });

  it('allows exactly one reversal per entry', async () => {
    const [rev] = await db('transactions')
      .insert({ user_id: user.id, account_id: accountId, direction: 'credit', amount: '250.50', kind: 'reversal', reversal_of_id: txnId, occurred_on: '2026-03-01', description: 'Reversal' })
      .returning('id');
    await db('transactions').where({ id: txnId }).update({ status: 'reversed', reversed_by_id: rev.id });
    await expect(db('transactions').where({ id: txnId }).update({ status: 'posted', reversed_by_id: null })).rejects.toThrow(/only be reversed once/);
    await expect(
      db('transactions').insert({ user_id: user.id, account_id: accountId, direction: 'credit', amount: '250.50', kind: 'reversal', reversal_of_id: txnId, occurred_on: '2026-03-01', description: 'Again' }),
    ).rejects.toMatchObject({ code: '23505' });
    const row = await db('account_current_balances').where({ account_id: accountId }).first();
    expect(row.balance).toBe('1000.0000');
  });

  it("rejects entries against another user's account", async () => {
    const other = await createUser();
    await expect(
      db('transactions').insert({ user_id: other.id, account_id: accountId, direction: 'debit', amount: '1', kind: 'expense', occurred_on: '2026-03-01', description: 'x' }),
    ).rejects.toThrow(/does not belong/);
  });
});
