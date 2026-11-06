import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/knex';
import { api, createUser, STRONG_PASSWORD, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

async function loginAgain(email: string) {
  const res = await api().post('/api/v1/auth/login').send({ email, password: STRONG_PASSWORD });
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}

describe('role-based access control', () => {
  let admin: TestUser;
  let member: TestUser;
  let adminAuth: { Authorization: string };

  beforeAll(async () => {
    await resetDatabase();
    admin = await createUser({ fullName: 'Ops Admin' });
    member = await createUser({ fullName: 'Regular Member' });
    await db('users').where({ id: admin.id }).update({ role: 'admin' });
    adminAuth = await loginAgain(admin.email);
  });
  afterAll(resetDatabase);

  it('forbids regular users from admin endpoints', async () => {
    const res = await api().get('/api/v1/admin/users').set(member.auth);
    expect(res.status).toBe(403);
  });

  it('lets admins list users and read platform stats', async () => {
    const users = await api().get('/api/v1/admin/users?search=member').set(adminAuth);
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(1);
    expect(users.body.meta.total).toBe(1);
    const stats = await api().get('/api/v1/admin/stats').set(adminAuth);
    expect(stats.body.data.users.total).toBe(2);
  });

  it('disables a user, revoking their sessions, and audits the change', async () => {
    const res = await api().patch(`/api/v1/admin/users/${member.id}/status`).set(adminAuth).send({ status: 'disabled', reason: 'Fraud review' });
    expect(res.status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(member.auth)).status).toBe(401);
    const login = await api().post('/api/v1/auth/login').send({ email: member.email, password: STRONG_PASSWORD });
    expect(login.status).toBe(403);
    const logs = await api().get(`/api/v1/admin/audit-logs?action=admin.&userId=${member.id}`).set(adminAuth);
    expect(logs.body.data[0]).toMatchObject({ action: 'admin.user_status_changed', actorId: admin.id });
  });

  it('prevents admins from changing their own role', async () => {
    const res = await api().patch(`/api/v1/admin/users/${admin.id}/role`).set(adminAuth).send({ role: 'user' });
    expect(res.status).toBe(400);
  });
});
