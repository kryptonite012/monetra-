import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { createUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('accounts and reference data schema', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('ships a system category tree for Indian households', async () => {
    const rows = await db('transaction_categories').where({ is_system: true });
    expect(rows.length).toBeGreaterThan(60);
    const rent = rows.find((r) => r.slug === 'housing.rent');
    const housing = rows.find((r) => r.slug === 'housing');
    expect(rent.parentId).toBe(housing.id);
    expect(rows.filter((r) => r.kind === 'income').map((r) => r.slug)).toContain('income.salary');
  });

  it('rejects unsafe card and UPI data', async () => {
    const user = await createUser();
    await expect(db('payment_methods').insert({ user_id: user.id, type: 'credit_card', label: 'Card', card_last4: '4111111111111111' })).rejects.toBeTruthy();
    await expect(db('payment_methods').insert({ user_id: user.id, type: 'upi', label: 'UPI', upi_vpa: 'not a vpa' })).rejects.toMatchObject({ code: '23514' });
    await db('payment_methods').insert({ user_id: user.id, type: 'upi', label: 'GPay', upi_vpa: 'asha.k@okaxis' });
  });

  it('validates account fields', async () => {
    const user = await createUser();
    await expect(db('accounts').insert({ user_id: user.id, name: 'HDFC', type: 'savings', ifsc: 'bad' })).rejects.toMatchObject({ code: '23514' });
    await db('accounts').insert({ user_id: user.id, name: 'HDFC Salary', type: 'salary', ifsc: 'HDFC0001234', account_number_last4: '9012' });
    await expect(db('accounts').insert({ user_id: user.id, name: 'hdfc salary', type: 'savings' })).rejects.toMatchObject({ code: '23505' });
  });
});
