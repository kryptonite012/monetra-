import type { Request } from 'express';
import { config } from '../../config/env';
import { db } from '../../db/knex';
import { hashPassword, randomToken, verifyPassword } from '../../lib/crypto';
import { badRequest, unauthorized, unprocessable } from '../../lib/errors';
import { layout, sendMail } from '../../lib/mailer';
import { checkPassword } from '../../lib/password-policy';
import { audit } from '../audit/audit.service';
import { notify } from '../notifications/notifications.service';
import { revokeAllSessions } from './session.service';
import { consumeAuthToken, createAuthToken } from './verification.service';

const RESET_TTL_SECONDS = 30 * 60;

async function notifyPasswordChanged(email: string): Promise<void> {
  await sendMail({
    to: email,
    subject: 'Your Monetra password was changed',
    text: 'The password for your Monetra account was just changed. If this was not you, reset your password immediately and contact support.',
    html: layout('Password changed', [
      'The password for your Monetra account was just changed.',
      'If this was not you, reset your password immediately and review your active sessions.',
    ]),
  });
}

function enforcePolicy(password: string, email: string, name?: string) {
  const check = checkPassword(password, { email, name });
  if (!check.ok) throw unprocessable('Password does not meet the security policy', { problems: check.problems });
}

/** Always succeeds from the caller's point of view so the endpoint cannot be used to discover accounts. */
export async function requestPasswordReset(email: string, req?: Request): Promise<void> {
  const user = await db('users').where({ email }).whereNull('deleted_at').first('id', 'email', 'status');
  if (!user || user.status === 'disabled') return;
  const token = randomToken(32);
  await createAuthToken(user.id, 'password_reset', token, RESET_TTL_SECONDS);
  const url = `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your Monetra password',
    text: `Use this link to choose a new password (valid for 30 minutes): ${url}\nIf you did not request this, you can ignore this email.`,
    html: layout('Reset your password', ['Use the button below to choose a new password. The link is valid for 30 minutes.', 'If you did not request this, you can safely ignore this email.'], {
      label: 'Choose a new password',
      url,
    }),
  });
  await audit({ action: 'auth.password_reset_requested', userId: user.id, actorId: null, req });
}

export async function resetPassword(token: string, newPassword: string, req?: Request): Promise<void> {
  const row = await consumeAuthToken('password_reset', token);
  if (!row) throw badRequest('This reset link is invalid or has expired');
  const user = await db('users as u').join('user_profiles as p', 'p.user_id', 'u.id').where('u.id', row.userId).first('u.email', 'p.full_name');
  enforcePolicy(newPassword, user.email, user.fullName);
  await db('users').where({ id: row.userId }).update({
    password_hash: await hashPassword(newPassword),
    password_changed_at: db.fn.now(),
    failed_login_count: 0,
    locked_until: null,
  });
  await revokeAllSessions(row.userId, 'password_reset');
  await audit({ action: 'auth.password_reset', userId: row.userId, actorId: row.userId, req });
  await notifyPasswordChanged(user.email);
}

export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
  req?: Request,
): Promise<{ revokedSessions: number }> {
  const user = await db('users as u').join('user_profiles as p', 'p.user_id', 'u.id').where('u.id', userId).first('u.email', 'u.password_hash', 'p.full_name');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  if (currentPassword === newPassword) throw badRequest('Choose a password you have not used for this account');
  enforcePolicy(newPassword, user.email, user.fullName);
  await db('users').where({ id: userId }).update({ password_hash: await hashPassword(newPassword), password_changed_at: db.fn.now() });
  const revokedSessions = await revokeAllSessions(userId, 'password_changed', sessionId);
  await audit({ action: 'auth.password_changed', userId, actorId: userId, req, metadata: { revokedSessions } });
  await notify(userId, { type: 'security_alert', severity: 'warning', title: 'Password changed', body: 'Your password was changed and other devices were signed out.', actionUrl: '/settings/security' });
  await notifyPasswordChanged(user.email);
  return { revokedSessions };
}
