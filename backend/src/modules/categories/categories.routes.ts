import { z } from 'zod';
import { db } from '../../db/knex';
import { badRequest, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, queryBool } from '../../lib/http';
import { audit } from '../audit/audit.service';
import { normalizeMerchant, suggestCategory } from './categorizer';
import { resolveCategory, visibleCategories } from './categories.service';

const kindEnum = z.enum(['income', 'expense', 'transfer']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0f766e');

// ----------------------------------------------------------------- categories
export const categories = apiRouter('/categories', 'Categories');

categories.get('/', {
  summary: 'List system and custom categories',
  query: z.object({ kind: kindEnum.optional(), tree: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = visibleCategories(user.id).orderBy([{ column: 'kind' }, { column: 'is_system', order: 'desc' }, { column: 'name' }]);
    if (query.kind) q.where({ kind: query.kind });
    const rows: Array<Record<string, any>> = await q.select('id', 'parent_id', 'slug', 'name', 'kind', 'icon', 'color', 'is_system');
    if (!query.tree) return rows;
    const byId = new Map<string, Record<string, any> & { children: unknown[] }>(rows.map((r) => [r.id, { ...r, children: [] }]));
    const roots: unknown[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  },
});

categories.post('/', {
  summary: 'Create a custom category',
  status: 201,
  body: z.object({ name: z.string().trim().min(2).max(60), kind: kindEnum, parentId: z.uuid().nullish(), icon: z.string().max(40).nullish(), color: color.nullish() }),
  handler: async ({ user, body, req }) => {
    if (body.parentId) {
      const parent = await resolveCategory(user.id, body.parentId, body.kind);
      if (parent?.parentId) throw unprocessable('Categories can be nested only one level deep');
    }
    const [row] = await db('transaction_categories')
      .insert({ user_id: user.id, name: body.name, kind: body.kind, parent_id: body.parentId ?? null, icon: body.icon ?? null, color: body.color ?? null })
      .returning('*');
    await audit({ action: 'category.created', req, entityType: 'category', entityId: row.id });
    return row;
  },
});

categories.patch('/:id', {
  summary: 'Rename or restyle a custom category',
  params: idParams,
  body: z.object({ name: z.string().trim().min(2).max(60), icon: z.string().max(40).nullable(), color: color.nullable() }).partial(),
  handler: async ({ user, params, body }) => {
    const [row] = await db('transaction_categories').where({ id: params.id, user_id: user.id }).update(body).returning('*');
    if (!row) throw notFound('Category');
    return row;
  },
});

categories.delete('/:id', {
  summary: 'Archive a custom category (existing transactions keep it)',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const [row] = await db('transaction_categories').where({ id: params.id, user_id: user.id }).whereNull('archived_at').update({ archived_at: db.fn.now() }).returning('id');
    if (!row) throw notFound('Category');
    await db('transaction_categories').where({ parent_id: params.id, user_id: user.id }).update({ archived_at: db.fn.now() });
    await audit({ action: 'category.archived', req, entityType: 'category', entityId: params.id });
    return undefined;
  },
});

categories.post('/suggest', {
  summary: 'Suggest a category for a description/merchant (explains its reasoning)',
  body: z.object({
    description: z.string().max(500).optional(),
    merchantName: z.string().max(120).optional(),
    merchantId: z.uuid().optional(),
    upiVpa: z.string().max(200).optional(),
    kind: kindEnum.optional(),
  }),
  handler: ({ user, body }) => suggestCategory(user.id, body),
});

// ------------------------------------------------------------------ merchants
export const merchants = apiRouter('/merchants', 'Categories');

const merchantBody = z.object({
  name: z.string().trim().min(2).max(120),
  defaultCategoryId: z.uuid().nullish(),
  upiVpa: z.string().trim().max(200).nullish(),
  website: z.url().max(200).nullish(),
});

merchants.get('/', {
  summary: 'List merchants with spend totals',
  query: z.object({ search: z.string().trim().max(100).optional() }),
  handler: async ({ user, query }) => {
    const q = db('merchants as m')
      .leftJoin('transactions as t', function join() {
        this.on('t.merchant_id', 'm.id').andOnVal('t.status', 'posted').andOnVal('t.kind', 'expense');
      })
      .where('m.user_id', user.id)
      .groupBy('m.id')
      .select('m.*', db.raw('COALESCE(SUM(t.amount), 0) AS total_spent'), db.raw('COUNT(t.id)::int AS transaction_count'), db.raw('MAX(t.occurred_on) AS last_seen_on'))
      .orderBy('m.name');
    if (query.search) q.whereILike('m.name', `%${query.search}%`);
    return q;
  },
});

merchants.post('/', {
  summary: 'Create a merchant',
  status: 201,
  body: merchantBody,
  handler: async ({ user, body }) => {
    await resolveCategory(user.id, body.defaultCategoryId);
    const [row] = await db('merchants')
      .insert({ user_id: user.id, name: body.name, normalized_name: normalizeMerchant(body.name), default_category_id: body.defaultCategoryId ?? null, upi_vpa: body.upiVpa ?? null, website: body.website ?? null })
      .returning('*');
    return row;
  },
});

merchants.patch('/:id', {
  summary: 'Update a merchant',
  params: idParams,
  body: merchantBody.partial(),
  handler: async ({ user, params, body }) => {
    if (body.defaultCategoryId) await resolveCategory(user.id, body.defaultCategoryId);
    const patch: Record<string, unknown> = {};
    if (body.name) Object.assign(patch, { name: body.name, normalized_name: normalizeMerchant(body.name) });
    if (body.defaultCategoryId !== undefined) patch.default_category_id = body.defaultCategoryId;
    if (body.upiVpa !== undefined) patch.upi_vpa = body.upiVpa;
    if (body.website !== undefined) patch.website = body.website;
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('merchants').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Merchant');
    return row;
  },
});

merchants.delete('/:id', {
  summary: 'Delete an unused merchant',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('merchants').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Merchant');
    return undefined;
  },
});

// ------------------------------------------------------- categorisation rules
export const rules = apiRouter('/categorization-rules', 'Categories');

const ruleBody = z.object({
  pattern: z.string().trim().min(2).max(100),
  matchField: z.enum(['any', 'description', 'merchant', 'upi']).default('any'),
  categoryId: z.uuid(),
  priority: z.number().int().min(1).max(1000).default(100),
});

rules.get('/', {
  summary: 'List auto-categorisation rules',
  handler: ({ user }) =>
    db('categorization_rules as r')
      .join('transaction_categories as c', 'c.id', 'r.category_id')
      .where('r.user_id', user.id)
      .select('r.*', 'c.name as category_name', 'c.kind as category_kind')
      .orderBy([{ column: 'r.priority' }, { column: 'r.created_at' }]),
});

rules.post('/', {
  summary: 'Create an auto-categorisation rule',
  status: 201,
  body: ruleBody,
  handler: async ({ user, body }) => {
    await resolveCategory(user.id, body.categoryId);
    const [row] = await db('categorization_rules')
      .insert({ user_id: user.id, pattern: body.pattern, match_field: body.matchField, category_id: body.categoryId, priority: body.priority })
      .returning('*');
    return row;
  },
});

rules.patch('/:id', {
  summary: 'Update a rule',
  params: idParams,
  body: ruleBody.partial(),
  handler: async ({ user, params, body }) => {
    if (body.categoryId) await resolveCategory(user.id, body.categoryId);
    const patch = Object.fromEntries(
      Object.entries({ pattern: body.pattern, match_field: body.matchField, category_id: body.categoryId, priority: body.priority }).filter(([, v]) => v !== undefined),
    );
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('categorization_rules').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Rule');
    return row;
  },
});

rules.delete('/:id', {
  summary: 'Delete a rule',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('categorization_rules').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Rule');
    return undefined;
  },
});
