import { z } from 'zod';
import { db } from '../../db/knex';
import { notFound } from '../../lib/errors';
import { apiRouter, envelope, idParams, pageMeta, paginationQuery, queryBool } from '../../lib/http';
import { unreadCount } from './notifications.service';

const r = apiRouter('/notifications', 'Notifications');

r.get('/', {
  summary: 'Your notifications (newest first)',
  query: paginationQuery.extend({ unread: queryBool.optional(), type: z.string().max(40).optional() }),
  handler: async ({ user, query }) => {
    const base = db('notifications').where({ user_id: user.id });
    if (query.unread) base.whereNull('read_at');
    if (query.type) base.where({ type: query.type });
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base.clone().orderBy('created_at', 'desc').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return envelope(rows, { ...pageMeta(query, Number(count)), unread: await unreadCount(user.id) });
  },
});

r.get('/unread-count', {
  summary: 'Number of unread notifications',
  handler: async ({ user }) => ({ unread: await unreadCount(user.id) }),
});

r.patch('/:id/read', {
  summary: 'Mark a notification as read',
  params: idParams,
  handler: async ({ user, params }) => {
    const [row] = await db('notifications').where({ id: params.id, user_id: user.id }).update({ read_at: db.raw('COALESCE(read_at, now())') }).returning('*');
    if (!row) throw notFound('Notification');
    return row;
  },
});

r.post('/read-all', {
  summary: 'Mark every notification as read',
  handler: async ({ user }) => ({ updated: await db('notifications').where({ user_id: user.id }).whereNull('read_at').update({ read_at: db.fn.now() }) }),
});

r.delete('/:id', {
  summary: 'Dismiss a notification',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('notifications').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Notification');
    return undefined;
  },
});

export default r.router;
