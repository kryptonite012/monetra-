import { db, type Db } from '../db/knex';
import { notFound, unprocessable } from './errors';

/** Loads a row owned by the user or throws 404 (never reveals other users' rows). */
export async function findOwned<T = Record<string, any>>(table: string, id: string, userId: string, entity: string, conn: Db = db): Promise<T> {
  const row = await conn(table).where({ id, user_id: userId }).first();
  if (!row) throw notFound(entity);
  return row as T;
}

/** Like findOwned, but for ids supplied inside a request body (422 instead of 404). */
export async function requireOwnedRef(table: string, id: string | null | undefined, userId: string, label: string, conn: Db = db) {
  if (!id) return null;
  const row = await conn(table).where({ id, user_id: userId }).first();
  if (!row) throw unprocessable(`${label} not found`, { field: label });
  return row as Record<string, any>;
}
