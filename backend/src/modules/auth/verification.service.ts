import type { Request } from 'express';
import { config } from '../../config/env';
import { db } from '../../db/knex';
import { decrypt, encrypt, lookupHash, randomDigits, randomToken, sha256 } from '../../lib/crypto';
import { AppError, badRequest, conflict } from '../../lib/errors';
import { layout, sendMail } from '../../lib/mailer';
import { sendSms } from '../../lib/sms';
import { audit } from '../audit/audit.service';

export type TokenPurpose = 'email_verify' | 'phone_verify' | 'password_reset' | 'mfa_challenge';

const MAX_CODE_ATTEMPTS = 5;

/** Stores a hashed single-use token, invalidating older unconsumed tokens with the same purpose. */
export async function createAuthToken(
  userId: string,
  purpose: TokenPurpose,
  token: string,
  ttlSeconds: number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db('auth_tokens').where({ user_id: userId, purpose }).whereNull('consumed_at').update({ consumed_at: db.fn.now() });
  await db('auth_tokens').insert({
    user_id: userId,
    purpose,
    token_hash: sha256(purpose === 'phone_verify' ? `${userId}:${token}` : token),
    expires_at: new Date(Date.now() + ttlSeconds * 1000),
    metadata: JSON.stringify(metadata),
  });
}

/** Atomically consumes a valid token and returns its row, or null if invalid/expired/used. */
export async function consumeAuthToken(purpose: TokenPurpose, token: string) {
  const [row] = await db('auth_tokens')
    .where({ purpose, token_hash: sha256(token) })
    .whereNull('consumed_at')
    .where('expires_at', '>', db.fn.now())
    .update({ consumed_at: db.fn.now() })
    .returning(['id', 'user_id', 'metadata']);
  return row ? { id: row.id as string, userId: row.userId as string, metadata: row.metadata as Record<string, unknown> } : null;
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendEmailVerification(userId: string): Promise<void> {
  const user = await db('users').where({ id: userId }).first('email', 'email_verified_at');
  if (!user || user.emailVerifiedAt) return;
  const token = randomToken(32);
  await createAuthToken(userId, 'email_verify', token, 24 * 3600, { email: user.email });
  const url = `${config.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your Monetra email address',
    text: `Confirm your email address to secure your Monetra account: ${url}\nThis link expires in 24 hours.`,
    html: layout('Confirm your email', ['Confirm your email address to secure your Monetra account.', 'This link expires in 24 hours.'], {
      label: 'Verify email',
      url,
    }),
  });
}

export async function confirmEmailVerification(token: string, req?: Request): Promise<string> {
  const row = await consumeAuthToken('email_verify', token);
  if (!row) throw badRequest('This verification link is invalid or has expired');
  const user = await db('users').where({ id: row.userId }).first('email');
  if (!user || user.email !== row.metadata.email) throw badRequest('This verification link is no longer valid');
  await db('users').where({ id: row.userId }).update({ email_verified_at: db.fn.now() });
  await audit({ action: 'auth.email_verified', userId: row.userId, actorId: row.userId, req });
  return row.userId;
}

// ---------------------------------------------------------------------------
// Phone verification (6-digit code, hashed, attempt-limited)
// ---------------------------------------------------------------------------

export async function sendPhoneVerification(userId: string, newPhone?: string): Promise<{ phoneLast4: string }> {
  const user = await db('users').where({ id: userId }).first('phone_encrypted');
  let phone: string;
  if (newPhone) {
    const hash = lookupHash(newPhone);
    const taken = await db('users').where({ phone_hash: hash }).whereNot({ id: userId }).whereNull('deleted_at').first('id');
    if (taken) throw conflict('This mobile number is already registered');
    phone = newPhone;
  } else if (user?.phoneEncrypted) {
    phone = decrypt(user.phoneEncrypted);
  } else {
    throw badRequest('Add a mobile number first');
  }
  const code = randomDigits(6);
  await createAuthToken(userId, 'phone_verify', code, 600, { phone: encrypt(phone) });
  await sendSms({ to: phone, body: `${code} is your Monetra verification code. It expires in 10 minutes. Never share it with anyone.` });
  return { phoneLast4: phone.slice(-4) };
}

export async function confirmPhoneVerification(userId: string, code: string, req?: Request): Promise<void> {
  const row = await db('auth_tokens')
    .where({ user_id: userId, purpose: 'phone_verify' })
    .whereNull('consumed_at')
    .where('expires_at', '>', db.fn.now())
    .orderBy('created_at', 'desc')
    .first();
  if (!row) throw badRequest('Request a new verification code');
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await db('auth_tokens').where({ id: row.id }).update({ consumed_at: db.fn.now() });
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Request a new one.');
  }
  if (row.tokenHash !== sha256(`${userId}:${code}`)) {
    await db('auth_tokens').where({ id: row.id }).increment('attempts', 1);
    throw badRequest('Incorrect verification code');
  }
  const phone = decrypt(String(row.metadata.phone));
  await db.transaction(async (trx) => {
    await trx('auth_tokens').where({ id: row.id }).update({ consumed_at: trx.fn.now() });
    await trx('users').where({ id: userId }).update({
      phone_encrypted: encrypt(phone),
      phone_hash: lookupHash(phone),
      phone_last4: phone.slice(-4),
      phone_verified_at: trx.fn.now(),
    });
  });
  await audit({ action: 'auth.phone_verified', userId, actorId: userId, req, metadata: { phoneLast4: phone.slice(-4) } });
}
