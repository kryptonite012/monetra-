import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { testOutbox } from '../../src/lib/mailer';
import { testSmsOutbox } from '../../src/lib/sms';
import { api, createUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

function tokenFromLatestEmail(to: string): string {
  const mail = [...testOutbox].reverse().find((m) => m.to === to);
  const match = mail?.text.match(/token=([A-Za-z0-9_%-]+)/);
  if (!match) throw new Error('no verification email');
  return decodeURIComponent(match[1]);
}

describe('email verification', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);
  beforeEach(() => {
    testOutbox.length = 0;
    testSmsOutbox.length = 0;
  });

  it('sends a link on registration and verifies once', async () => {
    const user = await createUser();
    const token = tokenFromLatestEmail(user.email);
    const ok = await api().post('/api/v1/auth/verify-email/confirm').send({ token });
    expect(ok.status).toBe(200);
    const me = await api().get('/api/v1/auth/me').set(user.auth);
    expect(me.body.data.emailVerified).toBe(true);
    const again = await api().post('/api/v1/auth/verify-email/confirm').send({ token });
    expect(again.status).toBe(400);
  });

  it('invalidates older links when a new one is requested', async () => {
    const user = await createUser();
    const first = tokenFromLatestEmail(user.email);
    await api().post('/api/v1/auth/verify-email/request').set(user.auth);
    const second = tokenFromLatestEmail(user.email);
    expect(second).not.toEqual(first);
    expect((await api().post('/api/v1/auth/verify-email/confirm').send({ token: first })).status).toBe(400);
    expect((await api().post('/api/v1/auth/verify-email/confirm').send({ token: second })).status).toBe(200);
  });

  it('verifies a phone number with a hashed, attempt-limited code', async () => {
    const user = await createUser();
    const req = await api().post('/api/v1/auth/verify-phone/request').set(user.auth).send({ phone: '+919812345678' });
    expect(req.status).toBe(200);
    expect(req.body.data.phoneLast4).toBe('5678');
    const code = testSmsOutbox.at(-1)!.body.slice(0, 6);
    const stored = await db('auth_tokens').where({ user_id: user.id, purpose: 'phone_verify' }).first();
    expect(stored.tokenHash).not.toContain(code);

    const wrong = await api().post('/api/v1/auth/verify-phone/confirm').set(user.auth).send({ code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await api().post('/api/v1/auth/verify-phone/confirm').set(user.auth).send({ code });
    expect(ok.status).toBe(200);
    const me = await api().get('/api/v1/auth/me').set(user.auth);
    expect(me.body.data).toMatchObject({ phoneVerified: true, phoneLast4: '5678' });
  });

  it('locks a phone code after too many wrong attempts', async () => {
    const user = await createUser();
    await api().post('/api/v1/auth/verify-phone/request').set(user.auth).send({ phone: '9811122233' });
    const code = testSmsOutbox.at(-1)!.body.slice(0, 6);
    const wrongCode = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/verify-phone/confirm').set(user.auth).send({ code: wrongCode });
    const blocked = await api().post('/api/v1/auth/verify-phone/confirm').set(user.auth).send({ code });
    expect(blocked.status).toBe(429);
  });
});
