import { z } from 'zod';
import { db } from '../../db/knex';
import { badRequest, notFound } from '../../lib/errors';
import { apiRouter, envelope, idParams, pageMeta, paginationQuery } from '../../lib/http';
import { audit } from '../audit/audit.service';
import { revokeAllSessions } from '../auth/session.service';

/**
 * Administration endpoints. Administrators manage accounts and review the
 * audit trail; by design they cannot read users' financial records.
 */
const r = apiRouter('/admin', 'Admin');

r.get('/stats', {
  summary: 'Platform health statistics (no financial data)',
  roles: ['admin', 'support'],
  handler: async () => {
    const [users] = await db('users').whereNull('deleted_at').select(
      db.raw('count(*)::int AS total'),
      db.raw(`count(*) FILTER (WHERE status = 'active')::int AS active`),
      db.raw('count(*) FILTER (WHERE mfa_enabled)::int AS mfa_enabled'),
      db.raw('count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS email_verified'),
    );
    const [sessions] = await db('sessions').whereNull('revoked_at').where('expires_at', '>', db.fn.now()).count({ count: '*' });
    const [logins] = await db('login_events')
      .where('created_at', '>', db.raw(`now() - interval '24 hours'`))
      .select(db.raw('count(*) FILTER (WHERE success)::int AS succeeded'), db.raw('count(*) FILTER (WHERE NOT success)::int AS failed'));
    return { users, activeSessions: Number(sessions.count), logins24h: logins };
  },
});

r.get('/users', {
  summary: 'List users',
  roles: ['admin', 'support'],
  query: paginationQuery.extend({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'locked', 'disabled']).optional(),
    role: z.enum(['user', 'admin', 'support']).optional(),
  }),
  handler: async ({ query }) => {
    const base = db('users as u').join('user_profiles as p', 'p.user_id', 'u.id').whereNull('u.deleted_at');
    if (query.search) base.where((q) => q.whereILike('u.email', `%${query.search}%`).orWhereILike('p.full_name', `%${query.search}%`));
    if (query.status) base.where('u.status', query.status);
    if (query.role) base.where('u.role', query.role);
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base
      .clone()
      .select('u.id', 'u.email', 'p.full_name', 'u.role', 'u.status', 'u.mfa_enabled', 'u.email_verified_at', 'u.last_login_at', 'u.created_at')
      .orderBy('u.created_at', 'desc')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return envelope(rows, pageMeta(query, Number(count)));
  },
});

r.patch('/users/:id/status', {
  summary: 'Enable, lock or disable a user (disabling signs them out everywhere)',
  roles: ['admin'],
  params: idParams,
  body: z.object({ status: z.enum(['active', 'locked', 'disabled']), reason: z.string().trim().min(3).max(500) }),
  handler: async ({ params, body, user, req }) => {
    if (params.id === user.id) throw badRequest('You cannot change your own status');
    const [row] = await db('users')
      .where({ id: params.id })
      .whereNull('deleted_at')
      .update({ status: body.status, locked_until: null, failed_login_count: 0 })
      .returning(['id', 'email', 'status']);
    if (!row) throw notFound('User');
    if (body.status !== 'active') await revokeAllSessions(params.id, `admin_${body.status}`);
    await audit({ action: 'admin.user_status_changed', userId: params.id, actorId: user.id, entityType: 'user', entityId: params.id, req, metadata: body });
    return row;
  },
});

r.patch('/users/:id/role', {
  summary: 'Change a user role',
  roles: ['admin'],
  params: idParams,
  body: z.object({ role: z.enum(['user', 'admin', 'support']) }),
  handler: async ({ params, body, user, req }) => {
    if (params.id === user.id) throw badRequest('You cannot change your own role');
    const [row] = await db('users').where({ id: params.id }).whereNull('deleted_at').update({ role: body.role }).returning(['id', 'email', 'role']);
    if (!row) throw notFound('User');
    await revokeAllSessions(params.id, 'role_changed');
    await audit({ action: 'admin.user_role_changed', userId: params.id, actorId: user.id, entityType: 'user', entityId: params.id, req, metadata: body });
    return row;
  },
});

r.get('/audit-logs', {
  summary: 'Search the platform audit trail',
  roles: ['admin', 'support'],
  query: paginationQuery.extend({
    userId: z.uuid().optional(),
    action: z.string().trim().max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  }),
  handler: async ({ query }) => {
    const base = db('audit_logs');
    if (query.userId) base.where('user_id', query.userId);
    if (query.action) base.whereILike('action', `${query.action}%`);
    if (query.from) base.where('created_at', '>=', query.from);
    if (query.to) base.where('created_at', '<=', query.to);
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base.clone().orderBy('id', 'desc').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return envelope(rows, pageMeta(query, Number(count)));
  },
});

export default r.router;
