import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { api, createUser, STRONG_PASSWORD } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('profile, export and deletion', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('updates profile fields with validation', async () => {
    const user = await createUser();
    const ok = await api()
      .patch('/api/v1/me/profile')
      .set(user.auth)
      .send({ city: 'Pune', state: 'Maharashtra', employmentType: 'salaried', monthlyIncomeEstimate: '85000', timezone: 'Asia/Kolkata' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profile).toMatchObject({ city: 'Pune', monthlyIncomeEstimate: '85000.0000' });
    const bad = await api().patch('/api/v1/me/profile').set(user.auth).send({ timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(422);
  });

  it('merges preferences and completes onboarding', async () => {
    const user = await createUser();
    await api().patch('/api/v1/me/preferences').set(user.auth).send({ theme: 'dark', emailNotifications: { billDue: true } });
    const prefs = await api().patch('/api/v1/me/preferences').set(user.auth).send({ emailNotifications: { emiDue: false } });
    expect(prefs.body.data).toEqual({ theme: 'dark', emailNotifications: { billDue: true, emiDue: false } });
    const onboard = await api().post('/api/v1/me/onboarding').set(user.auth).send({ occupation: 'Engineer' });
    expect(onboard.body.data.profile.onboardingCompleted).toBe(true);
  });

  it('exports personal data without secrets', async () => {
    const user = await createUser({ phone: '9876501234' });
    const res = await api().get('/api/v1/me/export').set(user.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="monetra-export-/);
    const body = JSON.parse(res.text);
    expect(body.account.phone).toBe('+919876501234');
    expect(body.data.user_profiles).toHaveLength(1);
    expect(res.text).not.toMatch(/scrypt\$/);
    expect(body.data.sessions).toBeUndefined();
  });

  it('deletes the account permanently after confirmation', async () => {
    const user = await createUser();
    const noConfirm = await api().delete('/api/v1/me').set(user.auth).send({ password: STRONG_PASSWORD, confirmation: 'yes' });
    expect(noConfirm.status).toBe(422);
    const wrongPw = await api().delete('/api/v1/me').set(user.auth).send({ password: 'Nope#Nope1234', confirmation: 'DELETE MY ACCOUNT' });
    expect(wrongPw.status).toBe(401);
    const ok = await api().delete('/api/v1/me').set(user.auth).send({ password: STRONG_PASSWORD, confirmation: 'DELETE MY ACCOUNT' });
    expect(ok.status).toBe(204);
    expect(await db('users').where({ id: user.id }).first()).toBeUndefined();
    expect(await db('user_profiles').where({ user_id: user.id }).first()).toBeUndefined();
    const audit = await db('audit_logs').where({ user_id: user.id, action: 'user.account_deleted' });
    expect(audit).toHaveLength(1);
  });
});
