import { afterAll, describe, expect, it } from 'vitest';
import { db, withTransaction } from '../../src/db/knex';
import { snakeKeys } from '../../src/db/case';

describe('database layer', () => {
  afterAll(async () => {
    await db.raw('DROP TABLE IF EXISTS tmp_case_check');
  });

  it('keeps NUMERIC as strings, DATE as plain dates and camelises rows', async () => {
    const { rows } = await db.raw(`SELECT 1234.5600::numeric(19,4) AS amount_due, DATE '2026-03-31' AS due_on, count(*) AS total FROM generate_series(1,3)`);
    expect(rows[0]).toEqual({ amountDue: '1234.5600', dueOn: '2026-03-31', total: 3 });
  });

  it('rolls back failed transactions', async () => {
    await db.raw('CREATE TABLE IF NOT EXISTS tmp_case_check (id serial primary key, some_value text)');
    await expect(
      withTransaction(async (trx) => {
        await trx('tmp_case_check').insert(snakeKeys({ someValue: 'x' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db('tmp_case_check').select('*');
    expect(rows).toHaveLength(0);
  });

  it('has the shared updated_at trigger function installed', async () => {
    const { rows } = await db.raw(`SELECT proname FROM pg_proc WHERE proname = 'set_updated_at'`);
    expect(rows).toHaveLength(1);
  });
});
