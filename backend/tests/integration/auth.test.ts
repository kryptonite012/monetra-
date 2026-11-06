import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { api, cookieValue, createUser, STRONG_PASSWORD } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('registration and login', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('registers a user, stores secrets safely and starts a session', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'Meera.Iyer@Example.in', password: STRONG_PASSWORD, fullName: 'Meera Iyer', phone: '98765 43210', acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'meera.iyer@example.in', phoneLast4: '3210', emailVerified: false, role: 'user' });
    expect(res.body.data.accessToken).toBeTruthy();
    expect(cookieValue(res, 'monetra_rt')).toBeTruthy();
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);

    const row = await db('users').where({ email: 'meera.iyer@example.in' }).first();
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.phoneEncrypted).not.toContain('9876543210');
    const session = await db('sessions').where({ user_id: row.id }).first();
    expect(session.tokenHash).not.toEqual(cookieValue(res, 'monetra_rt'));
  });

  it('rejects duplicate emails, weak passwords and missing consent', async () => {
    const dup = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'meera.iyer@example.in', password: STRONG_PASSWORD, fullName: 'M', acceptTerms: true });
    expect(dup.status).toBe(422); // fullName too short is caught first by validation
    const dup2 = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'meera.iyer@example.in', password: STRONG_PASSWORD, fullName: 'Meera Two', acceptTerms: true });
    expect(dup2.status).toBe(409);
    const weak = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.in', password: 'password', fullName: 'Weak Pass', acceptTerms: true });
    expect(weak.status).toBe(422);
    const noTerms = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'terms@example.in', password: STRONG_PASSWORD, fullName: 'No Terms' });
    expect(noTerms.status).toBe(422);
  });

  it('logs in and exposes the current user', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'MEERA.IYER@example.in', password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.mfaRequired).toBe(false);
    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.profile.fullName).toBe('Meera Iyer');
    expect(me.body.data.profile.baseCurrency).toBe('INR');
  });

  it('uses the same error for unknown users and wrong passwords', async () => {
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'ghost@example.in', password: STRONG_PASSWORD });
    const wrong = await api().post('/api/v1/auth/login').send({ email: 'meera.iyer@example.in', password: 'Wrong#Password1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toEqual(wrong.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong#Password1' });
    }
    const locked = await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    expect(locked.status).toBe(423);
    const events = await db('login_events').where({ user_id: user.id, success: false });
    expect(events.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects missing, forged and revoked tokens', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    const forged = await api().get('/api/v1/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(forged.body.error.code).toBe('TOKEN_INVALID');
    const user = await createUser();
    await db('sessions').where({ user_id: user.id }).update({ revoked_at: new Date() });
    const revoked = await api().get('/api/v1/auth/me').set(user.auth);
    expect(revoked.body.error.code).toBe('SESSION_REVOKED');
  });
});
