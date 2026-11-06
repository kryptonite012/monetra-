import { z } from 'zod';
import { db } from '../../db/knex';
import { apiRouter, envelope, pageMeta, paginationQuery } from '../../lib/http';

const r = apiRouter('/audit-logs', 'Security');

r.get('/', {
  summary: 'Your own audit trail (security and data changes)',
  query: paginationQuery.extend({ action: z.string().trim().max(100).optional() }),
  handler: async ({ user, query }) => {
    const base = db('audit_logs').where({ user_id: user.id });
    if (query.action) base.whereILike('action', `${query.action}%`);
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base
      .clone()
      .select('id', 'action', 'entity_type', 'entity_id', 'ip', 'user_agent', 'metadata', 'created_at')
      .orderBy('id', 'desc')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return envelope(rows, pageMeta(query, Number(count)));
  },
});

export default r.router;
