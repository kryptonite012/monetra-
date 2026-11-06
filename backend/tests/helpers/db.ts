import { db } from '../../src/db/knex';

/** Empties every application table between test files (TRUNCATE skips row triggers). */
export async function resetDatabase(): Promise<void> {
  const { rows } = await db.raw<{ rows: Array<{ tablename: string }> }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'knex_%'`,
  );
  if (rows.length === 0) return;
  await db.raw(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}
