import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { resetDatabase } from '../helpers/db';

describe('identity schema', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('enforces lowercase unique emails and valid roles', async () => {
    await db('users').insert({ email: 'asha@example.in', password_hash: 'x' });
    await expect(db('users').insert({ email: 'asha@example.in', password_hash: 'x' })).rejects.toMatchObject({ code: '23505' });
    await expect(db('users').insert({ email: 'Upper@Example.in', password_hash: 'x' })).rejects.toMatchObject({ code: '23514' });
    await expect(db('users').insert({ email: 'r@example.in', password_hash: 'x', role: 'root' })).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the audit log append-only', async () => {
    const [row] = await db('audit_logs').insert({ action: 'test.event' }).returning('id');
    await expect(db('audit_logs').where({ id: row.id }).update({ action: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(db('audit_logs').where({ id: row.id }).delete()).rejects.toThrow(/append-only/);
  });
});
