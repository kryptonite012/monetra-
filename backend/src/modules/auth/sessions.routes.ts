import { db } from '../../db/knex';
import { badRequest, notFound } from '../../lib/errors';
import { apiRouter, envelope, idParams, pageMeta, paginationQuery } from '../../lib/http';
import { audit } from '../audit/audit.service';
import { revokeAllSessions, revokeSession } from './session.service';

/** Session management and login-activity monitoring for the signed-in user. */
const r = apiRouter('/auth', 'Security');

r.get('/sessions', {
  summary: 'Active sessions (devices) for your account',
  handler: async ({ user }) => {
    const rows = await db('sessions')
      .where({ user_id: user.id })
      .whereNull('revoked_at')
      .where('expires_at', '>', db.fn.now())
      .select('id', 'device_label', 'ip', 'user_agent', 'created_at', 'last_used_at', 'expires_at', 'family_id')
      .orderBy('last_used_at', 'desc');
    const current = await db('sessions').where({ id: user.sessionId }).first('family_id');
    return rows.map(({ familyId, ...s }) => ({ ...s, current: s.id === user.sessionId || familyId === current?.familyId }));
  },
});

r.delete('/sessions/:id', {
  summary: 'Sign out a specific device',
  params: idParams,
  handler: async ({ params, user, req }) => {
    if (params.id === user.sessionId) throw badRequest('Use sign out to end the current session');
    const session = await db('sessions').where({ id: params.id, user_id: user.id }).whereNull('revoked_at').first('id', 'family_id');
    if (!session) throw notFound('Session');
    // Revoke the whole rotation family so the device cannot refresh back in.
    await db('sessions').where({ family_id: session.familyId }).whereNull('revoked_at').update({ revoked_at: db.fn.now(), revoked_reason: 'user_revoked' });
    await revokeSession(params.id, 'user_revoked');
    await audit({ action: 'auth.session_revoked', userId: user.id, entityType: 'session', entityId: params.id, req });
    return undefined;
  },
});

r.post('/sessions/revoke-others', {
  summary: 'Sign out every other device',
  handler: async ({ user, req }) => {
    const revoked = await revokeAllSessions(user.id, 'user_revoked_others', user.sessionId);
    await audit({ action: 'auth.sessions_revoked_others', userId: user.id, req, metadata: { revoked } });
    return { revoked };
  },
});

r.get('/login-activity', {
  summary: 'Recent sign-in attempts for your account',
  query: paginationQuery,
  handler: async ({ user, query }) => {
    const base = db('login_events').where({ user_id: user.id });
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base
      .clone()
      .select('id', 'success', 'reason', 'method', 'ip', 'user_agent', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return envelope(rows, pageMeta(query, Number(count)));
  },
});

export default r.router;
