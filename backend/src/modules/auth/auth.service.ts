import type { Request } from 'express';
import { config } from '../../config/env';
import { db, withTransaction } from '../../db/knex';
import {
  dummyPasswordHash,
  encrypt,
  hashPassword,
  lookupHash,
  passwordNeedsRehash,
  verifyPassword,
} from '../../lib/crypto';
import { AppError, conflict, unauthorized, unprocessable } from '../../lib/errors';
import { checkPassword } from '../../lib/password-policy';
import { audit, clientInfo } from '../audit/audit.service';
import { notify } from '../notifications/notifications.service';
import { issueSession, type IssuedSession } from './session.service';
import { toPublicUser } from './user.serializer';

export type LoginResult =
  | { mfaRequired: false; session: IssuedSession; user: ReturnType<typeof toPublicUser> }
  | { mfaRequired: true; mfaToken: string };

export async function recordLoginEvent(
  req: Request | undefined,
  data: { userId?: string | null; email?: string; success: boolean; reason?: string; method?: string },
): Promise<void> {
  const { ip, userAgent } = clientInfo(req);
  await db('login_events').insert({
    user_id: data.userId ?? null,
    email_attempted: data.email ?? null,
    success: data.success,
    reason: data.reason ?? null,
    method: data.method ?? 'password',
    ip,
    user_agent: userAgent,
  });
}

export async function loadUserWithProfile(userId: string) {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) return null;
  const profile = await db('user_profiles').where({ user_id: userId }).first();
  return toPublicUser(user, profile);
}

export async function register(
  input: { email: string; password: string; fullName: string; phone?: string },
  req?: Request,
) {
  const strength = checkPassword(input.password, { email: input.email, name: input.fullName });
  if (!strength.ok) throw unprocessable('Password does not meet the security policy', { problems: strength.problems });

  const existing = await db('users').where({ email: input.email }).whereNull('deleted_at').first('id');
  if (existing) throw conflict('An account with this email already exists');

  const phoneHash = input.phone ? lookupHash(input.phone) : null;
  if (phoneHash) {
    const phoneTaken = await db('users').where({ phone_hash: phoneHash }).whereNull('deleted_at').first('id');
    if (phoneTaken) throw conflict('This mobile number is already registered');
  }

  const passwordHash = await hashPassword(input.password);
  const userId = await withTransaction(async (trx) => {
    const [user] = await trx('users')
      .insert({
        email: input.email,
        password_hash: passwordHash,
        phone_encrypted: input.phone ? encrypt(input.phone) : null,
        phone_hash: phoneHash,
        phone_last4: input.phone ? input.phone.slice(-4) : null,
      })
      .returning(['id']);
    await trx('user_profiles').insert({ user_id: user.id, full_name: input.fullName });
    await audit({ action: 'auth.register', userId: user.id, actorId: user.id, entityType: 'user', entityId: user.id, req }, trx);
    return user.id as string;
  });
  return userId;
}

/**
 * Verifies credentials with account lockout and constant-time behaviour for
 * unknown emails. Returns either a full session or an MFA challenge.
 */
export async function login(
  email: string,
  password: string,
  req?: Request,
  createMfaChallenge?: (userId: string) => Promise<string>,
): Promise<LoginResult> {
  const user = await db('users').where({ email }).whereNull('deleted_at').first();

  if (!user) {
    await verifyPassword(password, await dummyPasswordHash());
    await recordLoginEvent(req, { email, success: false, reason: 'unknown_email' });
    throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }

  const now = new Date();
  if (user.lockedUntil && new Date(user.lockedUntil) > now) {
    await verifyPassword(password, user.passwordHash);
    await recordLoginEvent(req, { userId: user.id, email, success: false, reason: 'locked' });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Please try again later or reset your password.');
  }
  if (user.status !== 'active') {
    await recordLoginEvent(req, { userId: user.id, email, success: false, reason: `status_${user.status}` });
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact support for help.');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= config.MAX_FAILED_LOGINS;
    await db('users')
      .where({ id: user.id })
      .update({
        failed_login_count: lock ? 0 : failed,
        locked_until: lock ? new Date(now.getTime() + config.ACCOUNT_LOCK_MINUTES * 60_000) : null,
      });
    await recordLoginEvent(req, { userId: user.id, email, success: false, reason: lock ? 'bad_password_locked' : 'bad_password' });
    if (lock) {
      await audit({ action: 'auth.account_locked', userId: user.id, actorId: user.id, entityType: 'user', entityId: user.id, req });
      await notify(user.id, {
        type: 'security_alert',
        severity: 'critical',
        title: 'Account temporarily locked',
        body: `We locked sign-in for ${config.ACCOUNT_LOCK_MINUTES} minutes after ${config.MAX_FAILED_LOGINS} incorrect password attempts. If this was not you, reset your password.`,
        actionUrl: '/settings/security',
      });
    }
    throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }

  const updates: Record<string, unknown> = { failed_login_count: 0, locked_until: null };
  if (passwordNeedsRehash(user.passwordHash)) updates.password_hash = await hashPassword(password);
  await db('users').where({ id: user.id }).update(updates);

  if (user.mfaEnabled && createMfaChallenge) {
    await recordLoginEvent(req, { userId: user.id, email, success: true, reason: 'mfa_pending' });
    return { mfaRequired: true, mfaToken: await createMfaChallenge(user.id) };
  }

  return completeLogin(user.id, req, 'password');
}

/** Final step of every successful sign-in: issue the session and stamp activity. */
export async function completeLogin(userId: string, req: Request | undefined, method: string): Promise<LoginResult> {
  const user = await db('users').where({ id: userId }).first();
  const session = await issueSession({ id: user.id, email: user.email, role: user.role }, req);
  await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
  const { ip, userAgent } = clientInfo(req);
  const knownDevice = await db('login_events')
    .where({ user_id: user.id, success: true, user_agent: userAgent })
    .whereNot({ reason: 'mfa_pending' })
    .first('id');
  await recordLoginEvent(req, { userId: user.id, email: user.email, success: true, method });
  if (!knownDevice && method !== 'registration') {
    await notify(user.id, {
      type: 'security_alert',
      severity: 'warning',
      title: 'New sign-in to your account',
      body: `A new device signed in${ip ? ` from IP ${ip}` : ''}. If this was not you, revoke the session and change your password.`,
      actionUrl: '/settings/security',
      data: { userAgent },
    });
  }
  await audit({ action: 'auth.login', userId: user.id, actorId: user.id, entityType: 'session', entityId: session.sessionId, req, metadata: { method } });
  const fresh = await loadUserWithProfile(user.id);
  return { mfaRequired: false, session, user: fresh! };
}
