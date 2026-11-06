import path from 'node:path';
import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import { config } from '../config/env';
import { postProcessResponse } from './case';

// DATE columns are business dates: keep them as 'YYYY-MM-DD' strings to avoid timezone shifts.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// NUMERIC stays a string (pg default) so money is never coerced to a float.
// BIGINT counts are returned as numbers when they are safe integers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

const isCompiled = path.extname(__filename) === '.js';

export function knexConfig(options: { camelize?: boolean; url?: string } = {}): Knex.Config {
  return {
    client: 'pg',
    connection: {
      connectionString: options.url ?? config.DATABASE_URL,
      ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    },
    pool: { min: config.DATABASE_POOL_MIN, max: config.DATABASE_POOL_MAX },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations',
      loadExtensions: [isCompiled ? '.js' : '.ts'],
    },
    postProcessResponse: options.camelize === false ? undefined : postProcessResponse,
  };
}

/** Application query builder. Rows come back with camelCase keys. */
export const db = knexFactory(knexConfig());

export type Db = Knex | Knex.Transaction;

/** Runs `fn` inside a database transaction; everything rolls back if it throws. */
export function withTransaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}
