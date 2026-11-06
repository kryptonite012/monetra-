import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, STRONG_PASSWORD } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('session management and activity', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('lists devices and revokes a specific one', async () => {
    const user = await createUser();
    const phone = await api().post('/api/v1/auth/login').set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0').send({ email: user.email, password: STRONG_PASSWORD });
    const phoneAuth = { Authorization: `Bearer ${phone.body.data.accessToken}` };

    const list = await api().get('/api/v1/auth/sessions').set(user.auth);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect(other.deviceLabel).toBe('Chrome on Android');

    const self = list.body.data.find((s: { current: boolean }) => s.current);
    expect((await api().delete(`/api/v1/auth/sessions/${self.id}`).set(user.auth)).status).toBe(400);
    expect((await api().delete(`/api/v1/auth/sessions/${other.id}`).set(user.auth)).status).toBe(204);
    expect((await api().get('/api/v1/auth/me').set(phoneAuth)).status).toBe(401);
  });

  it('signs out all other devices', async () => {
    const user = await createUser();
    await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    const res = await api().post('/api/v1/auth/sessions/revoke-others').set(user.auth);
    expect(res.body.data.revoked).toBe(2);
    expect((await api().get('/api/v1/auth/sessions').set(user.auth)).body.data).toHaveLength(1);
  });

  it('shows login activity and the personal audit trail', async () => {
    const user = await createUser();
    await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong#Password1' });
    const activity = await api().get('/api/v1/auth/login-activity').set(user.auth);
    expect(activity.body.data.some((e: { success: boolean; reason: string }) => !e.success && e.reason === 'bad_password')).toBe(true);
    const audit = await api().get('/api/v1/audit-logs').set(user.auth);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['auth.register', 'auth.login']));
  });
});
