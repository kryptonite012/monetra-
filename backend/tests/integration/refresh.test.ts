import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { api, cookieValue, createUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

const refresh = (cookie: string) => api().post('/api/v1/auth/refresh').set('Cookie', cookie);

describe('refresh token rotation', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('rotates refresh tokens and issues working access tokens', async () => {
    const user = await createUser();
    const res = await refresh(user.cookie);
    expect(res.status).toBe(200);
    const next = cookieValue(res, 'monetra_rt');
    expect(next).toBeTruthy();
    expect(`monetra_rt=${next}`).not.toEqual(user.cookie);
    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    const sessions = await db('sessions').where({ user_id: user.id }).orderBy('created_at');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].revokedReason).toBe('rotated');
    expect(sessions[0].familyId).toEqual(sessions[1].familyId);
  });

  it('treats an immediate replay as a multi-tab race', async () => {
    const user = await createUser();
    await refresh(user.cookie);
    const replay = await refresh(user.cookie);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('REFRESH_RACE');
  });

  it('revokes the whole family when a rotated token is reused later', async () => {
    const user = await createUser();
    const first = await refresh(user.cookie);
    const latest = `monetra_rt=${cookieValue(first, 'monetra_rt')}`;
    // Simulate the stolen token being replayed after the grace window.
    await db('sessions').where({ user_id: user.id, revoked_reason: 'rotated' }).update({ revoked_at: new Date(Date.now() - 60_000) });
    const reuse = await refresh(user.cookie);
    expect(reuse.status).toBe(401);
    const legit = await refresh(latest);
    expect(legit.status).toBe(401);
    const active = await db('sessions').where({ user_id: user.id }).whereNull('revoked_at');
    expect(active).toHaveLength(0);
    const audit = await db('audit_logs').where({ user_id: user.id, action: 'auth.refresh_reuse_detected' });
    expect(audit).toHaveLength(1);
  });

  it('logs out and invalidates the session', async () => {
    const user = await createUser();
    const out = await api().post('/api/v1/auth/logout').set('Cookie', user.cookie).set(user.auth);
    expect(out.status).toBe(204);
    expect((await refresh(user.cookie)).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set(user.auth)).status).toBe(401);
  });

  it('rejects refresh without a cookie', async () => {
    const res = await api().post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});
