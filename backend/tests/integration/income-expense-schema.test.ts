import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { createUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('income, expense and budget schema', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('enforces net = gross - deductions on income records', async () => {
    const user = await createUser();
    const [acct] = await db('accounts').insert({ user_id: user.id, name: 'Bank', type: 'savings' }).returning('id');
    const [txn] = await db('transactions')
      .insert({ user_id: user.id, account_id: acct.id, direction: 'credit', amount: '90000', kind: 'income', occurred_on: '2026-03-31', description: 'Salary' })
      .returning('id');
    await expect(
      db('income_records').insert({ user_id: user.id, transaction_id: txn.id, source_type: 'salary', gross_amount: '100000', tax_deducted: '10000', net_amount: '95000' }),
    ).rejects.toMatchObject({ code: '23514' });
    await db('income_records').insert({ user_id: user.id, transaction_id: txn.id, source_type: 'salary', gross_amount: '100000', tax_deducted: '10000', net_amount: '90000' });
  });

  it('requires budgets to start on the first of the month', async () => {
    const user = await createUser();
    await expect(db('budgets').insert({ user_id: user.id, month: '2026-03-15', name: 'March' })).rejects.toMatchObject({ code: '23514' });
    await db('budgets').insert({ user_id: user.id, month: '2026-03-01', name: 'March' });
  });
});
