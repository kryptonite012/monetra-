import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { createUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('wealth, bills and notification schema', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('checks installment arithmetic and price-source labels', async () => {
    const user = await createUser();
    const [loan] = await db('loans')
      .insert({ user_id: user.id, name: 'Car', loan_type: 'vehicle', lender: 'SBI', principal: '500000', interest_rate: '9', tenure_months: 60, start_date: '2026-01-01', first_emi_date: '2026-02-05', emi_amount: '10379' })
      .returning('id');
    await expect(
      db('loan_installments').insert({ user_id: user.id, loan_id: loan.id, installment_no: 1, due_date: '2026-02-05', opening_principal: '500000', emi_amount: '10379', principal_component: '6000', interest_component: '3750', closing_principal: '494000' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(db('investments').insert({ user_id: user.id, instrument_type: 'stock', name: 'X', price_source: 'guess' })).rejects.toMatchObject({ code: '23514' });
  });

  it('dedupes notifications per user', async () => {
    const user = await createUser();
    await db('notifications').insert({ user_id: user.id, type: 'bill_due', title: 't', body: 'b', dedupe_key: 'bill:1:2026-03' });
    await expect(db('notifications').insert({ user_id: user.id, type: 'bill_due', title: 't', body: 'b', dedupe_key: 'bill:1:2026-03' })).rejects.toMatchObject({ code: '23505' });
  });
});
