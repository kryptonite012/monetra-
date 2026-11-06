import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { totp } from '../../src/lib/totp';
import { api, createUser, STRONG_PASSWORD, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('two-factor authentication', () => {
  let user: TestUser;
  let secret: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
  });
  afterAll(resetDatabase);

  it('sets up TOTP and stores the secret encrypted', async () => {
    const setup = await api().post('/api/v1/auth/mfa/setup').set(user.auth);
    expect(setup.status).toBe(200);
    expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = setup.body.data.secret;
    const bad = await api().post('/api/v1/auth/mfa/enable').set(user.auth).send({ code: '000000' });
    expect(bad.status).toBe(400);
    const ok = await api().post('/api/v1/auth/mfa/enable').set(user.auth).send({ code: totp(secret) });
    expect(ok.status).toBe(200);
    recoveryCodes = ok.body.data.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const row = await db('users').where({ id: user.id }).first();
    expect(row.mfaEnabled).toBe(true);
    expect(row.mfaSecretEncrypted).not.toContain(secret);
  });

  it('requires a second factor at login and blocks code replay', async () => {
    const step1 = await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    expect(step1.body.data.mfaRequired).toBe(true);
    expect(step1.body.data.accessToken).toBeUndefined();
    const replay = await api().post('/api/v1/auth/login/mfa').send({ mfaToken: step1.body.data.mfaToken, code: totp(secret) });
    expect(replay.status).toBe(401);
    const ok = await api()
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: step1.body.data.mfaToken, code: totp(secret, Date.now() + 30_000) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const reuse = await api().post('/api/v1/auth/login/mfa').send({ mfaToken: step1.body.data.mfaToken, code: totp(secret) });
    expect(reuse.status).toBe(401);
  });

  it('accepts each recovery code only once', async () => {
    const login = async () => (await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD })).body.data.mfaToken;
    const first = await api().post('/api/v1/auth/login/mfa').send({ mfaToken: await login(), recoveryCode: recoveryCodes[0] });
    expect(first.status).toBe(200);
    const second = await api().post('/api/v1/auth/login/mfa').send({ mfaToken: await login(), recoveryCode: recoveryCodes[0] });
    expect(second.status).toBe(401);
    const status = await api().get('/api/v1/auth/mfa').set(user.auth);
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesRemaining: 9 });
  });

  it('disables MFA only with password and a valid factor', async () => {
    const noPw = await api().post('/api/v1/auth/mfa/disable').set(user.auth).send({ password: 'Wrong#Password9', recoveryCode: recoveryCodes[1] });
    expect(noPw.status).toBe(401);
    const ok = await api().post('/api/v1/auth/mfa/disable').set(user.auth).send({ password: STRONG_PASSWORD, recoveryCode: recoveryCodes[2] });
    expect(ok.status).toBe(200);
    const login = await api().post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PASSWORD });
    expect(login.body.data.mfaRequired).toBe(false);
  });
});
