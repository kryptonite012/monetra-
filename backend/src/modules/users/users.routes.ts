import { z } from 'zod';
import { db } from '../../db/knex';
import { notFound } from '../../lib/errors';
import { apiRouter } from '../../lib/http';
import { audit } from '../audit/audit.service';
import { loadUserWithProfile } from '../auth/auth.service';
import { clearRefreshCookie } from '../auth/session.service';
import { deleteAccountSchema, preferencesSchema, profileSchema } from './users.schemas';
import { deleteAccount, exportUserData, updatePreferences, updateProfile } from './users.service';

const r = apiRouter('/me', 'Profile');

r.get('/', {
  summary: 'Your account and profile',
  handler: async ({ user }) => {
    const me = await loadUserWithProfile(user.id);
    if (!me) throw notFound('User');
    return me;
  },
});

r.patch('/profile', {
  summary: 'Update profile details',
  body: profileSchema,
  handler: ({ user, body, req }) => updateProfile(user.id, body, req),
});

r.patch('/preferences', {
  summary: 'Update app and notification preferences',
  body: preferencesSchema,
  handler: ({ user, body }) => updatePreferences(user.id, body),
});

r.post('/onboarding', {
  summary: 'Save onboarding answers and mark onboarding complete',
  body: profileSchema.extend({ completed: z.literal(true).default(true) }),
  handler: async ({ user, body, req }) => {
    const { completed: _completed, ...profile } = body;
    await db('user_profiles').where({ user_id: user.id }).update({ onboarding_completed: true });
    return updateProfile(user.id, profile, req);
  },
});

r.get('/export', {
  summary: 'Download all of your data as JSON',
  raw: true,
  handler: async ({ user, req, res }) => {
    const data = await exportUserData(user.id);
    await audit({ action: 'user.data_exported', userId: user.id, req });
    res.setHeader('Content-Disposition', `attachment; filename="monetra-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(data, null, 2));
  },
});

r.delete('/', {
  summary: 'Permanently delete your account and all data',
  body: deleteAccountSchema,
  handler: async ({ user, body, req, res }) => {
    await deleteAccount(user.id, body, req);
    clearRefreshCookie(res);
    return undefined;
  },
});

export default r.router;
