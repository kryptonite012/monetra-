import { db, type Db } from '../../db/knex';
import { unprocessable } from '../../lib/errors';

export type CategoryKind = 'income' | 'expense' | 'transfer';

/** Categories visible to a user: the system tree plus their own, excluding archived ones. */
export function visibleCategories(userId: string, conn: Db = db) {
  return conn('transaction_categories')
    .where((q) => q.whereNull('user_id').orWhere('user_id', userId))
    .whereNull('archived_at');
}

/** Validates a category id from a request and checks it matches the expected kind. */
export async function resolveCategory(userId: string, categoryId: string | null | undefined, kind?: CategoryKind, conn: Db = db) {
  if (!categoryId) return null;
  const cat = await visibleCategories(userId, conn).where({ id: categoryId }).first();
  if (!cat) throw unprocessable('Category not found', { field: 'categoryId' });
  if (kind && cat.kind !== kind) throw unprocessable(`Choose a ${kind} category`, { field: 'categoryId' });
  return cat;
}

export async function categoryBySlug(slug: string, conn: Db = db): Promise<string | null> {
  const row = await conn('transaction_categories').where({ slug }).first('id');
  return row?.id ?? null;
}

/** Returns the id of a category and all of its descendants (for budget roll-ups). */
export async function categoryWithDescendants(categoryId: string, conn: Db = db): Promise<string[]> {
  const { rows } = await conn.raw<{ rows: Array<{ id: string }> }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM transaction_categories WHERE id = ?
       UNION ALL
       SELECT c.id FROM transaction_categories c JOIN tree t ON c.parent_id = t.id
     ) SELECT id FROM tree`,
    [categoryId],
  );
  return rows.map((r) => r.id);
}
