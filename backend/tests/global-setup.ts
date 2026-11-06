import { execFileSync } from 'node:child_process';
import path from 'node:path';
import knexFactory from 'knex';

/** Recreates the test schema from scratch and applies every migration once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://monetra:monetra@localhost:5432/monetra_test';
  const admin = knexFactory({ client: 'pg', connection: url });
  await admin.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await admin.raw('CREATE SCHEMA public');
  await admin.destroy();
  // Run the real migration CLI (through tsx) so TypeScript migrations resolve exactly as in development.
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/db/migrate.ts', 'latest'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: url, LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });
}
