import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testOutbox } from '../../src/lib/mailer';
import { api, createUser, STRONG_PASSWORD } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

const NEW_PASSWORD = 'Saffron!Harbor77';

describe('password flows', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);
  beforeEach(() => {
    testOutbox.length = 0;
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await api().post('/api/v1/auth/password/forgot').send({ email: 'nobody@example.in' });
    expect(res.status).toBe(202);
    expect(testOutbox).toHaveLength(0);
  });

  it('resets a password with a single-use token and signs out sessions', async () => {
    const user = await createUser();
    testOutbox.length = 0;
    const forgot = await api().post('/api/v1/auth/password/forgot').send({ email: user.email });
    expect(forgot.status).toBe(202);
    const token = decodeURIComponent(testOutbox[0].text.match(/token=([A-Za-z0-9_%-]+)/)![1]);

    const weak = await api().post('/api/v1/auth/password/reset').send({ token, password: 'weakpass' });
    expect(weak.status).toBe(422);
    const ok = await api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(user.auth)).status).toBe(401);
    expect((await api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD })).status).toBe(400);
    const login = await api().post('/api/v1/auth/login').send({ email: user.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(testOutbox.some((m) => m.subject.includes('password was changed'))).toBe(true);
  });

  it('changes the password and keeps only the current session', async () => {
    const user = await createUser();
    const other = await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    const wrong = await api().post('/api/v1/auth/password/change').set(user.auth).send({ currentPassword: 'Nope#Nope1234', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(401);
    const ok = await api().post('/api/v1/auth/password/change').set(user.auth).send({ currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.revokedSessions).toBe(1);
    expect((await api().get('/api/v1/auth/me').set(user.auth)).status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${other.body.data.accessToken}`)).status).toBe(401);
  });
});
