import { db } from '../../src/db/knex';

/**
 * Removes all user-generated data between test files while keeping reference
 * data (system categories). Deleting users cascades to every owned row; the
 * ledger purge flag is the sanctioned way to delete immutable transactions.
 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL monetra.allow_ledger_purge = 'on'`);
    await trx('users').delete();
  });
  await db.raw('TRUNCATE audit_logs, login_events RESTART IDENTITY');
}
