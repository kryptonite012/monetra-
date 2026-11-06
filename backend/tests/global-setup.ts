import knexFactory from 'knex';
import { migrateLatest } from '../src/db/migrate';

/** Recreates the test schema from scratch and applies every migration once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://monetra:monetra@localhost:5432/monetra_test';
  const admin = knexFactory({ client: 'pg', connection: url });
  await admin.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await admin.raw('CREATE SCHEMA public');
  await admin.destroy();
  await migrateLatest(url);
}
