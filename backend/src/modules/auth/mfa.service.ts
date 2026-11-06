import type { Request } from 'express';
import QRCode from 'qrcode';
import { config } from '../../config/env';
import { db } from '../../db/knex';
import { decrypt, encrypt, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, badRequest, unauthorized } from '../../lib/errors';
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp';
import { randomBytes } from 'node:crypto';
import { audit } from '../audit/audit.service';
import { completeLogin, recordLoginEvent, type LoginResult } from './auth.service';
import { createAuthToken } from './verification.service';

const MAX_CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

const normaliseRecovery = (code: string) => code.toUpperCase().replace(/[^A-Z2-7]/g, '');

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.transaction(async (trx) => {
    await trx('mfa_recovery_codes').where({ user_id: userId }).delete();
    await trx('mfa_recovery_codes').insert(codes.map((c) => ({ user_id: userId, code_hash: sha256(normaliseRecovery(c)) })));
  });
  return codes;
}

/** Checks a TOTP code (with replay protection) or a single-use recovery code. */
async function verifySecondFactor(userId: string, input: { code?: string; recoveryCode?: string }): Promise<'totp' | 'recovery' | null> {
  const user = await db('users').where({ id: userId }).first('mfa_secret_encrypted', 'mfa_last_used_step');
  if (!user?.mfaSecretEncrypted) return null;
  if (input.code) {
    const step = verifyTotp(decrypt(user.mfaSecretEncrypted), input.code, {
      afterStep: user.mfaLastUsedStep != null ? Number(user.mfaLastUsedStep) : undefined,
    });
    if (step === null) return null;
    await db('users').where({ id: userId }).update({ mfa_last_used_step: step });
    return 'totp';
  }
  if (input.recoveryCode) {
    const [used] = await db('mfa_recovery_codes')
      .where({ user_id: userId, code_hash: sha256(normaliseRecovery(input.recoveryCode)) })
      .whereNull('used_at')
      .update({ used_at: db.fn.now() })
      .returning('id');
    return used ? 'recovery' : null;
  }
  return null;
}

export async function startMfaSetup(userId: string) {
  const user = await db('users').where({ id: userId }).first('email', 'mfa_enabled');
  if (user.mfaEnabled) throw badRequest('Two-factor authentication is already enabled');
  const secret = generateTotpSecret();
  await db('users').where({ id: userId }).update({ mfa_pending_secret_encrypted: encrypt(secret) });
  const url = otpauthUrl(secret, user.email, config.APP_NAME);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function enableMfa(userId: string, code: string, req?: Request): Promise<string[]> {
  const user = await db('users').where({ id: userId }).first('mfa_pending_secret_encrypted', 'mfa_enabled');
  if (user.mfaEnabled) throw badRequest('Two-factor authentication is already enabled');
  if (!user.mfaPendingSecretEncrypted) throw badRequest('Start two-factor setup first');
  const secret = decrypt(user.mfaPendingSecretEncrypted);
  const step = verifyTotp(secret, code);
  if (step === null) throw badRequest('That code is not valid. Check your device time and try again.');
  await db('users').where({ id: userId }).update({
    mfa_enabled: true,
    mfa_secret_encrypted: encrypt(secret),
    mfa_pending_secret_encrypted: null,
    mfa_last_used_step: step,
    mfa_enabled_at: db.fn.now(),
  });
  const codes = await replaceRecoveryCodes(userId);
  await audit({ action: 'auth.mfa_enabled', userId, actorId: userId, req });
  return codes;
}

export async function disableMfa(userId: string, password: string, factor: { code?: string; recoveryCode?: string }, req?: Request) {
  const user = await db('users').where({ id: userId }).first('password_hash', 'mfa_enabled');
  if (!user.mfaEnabled) throw badRequest('Two-factor authentication is not enabled');
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  if (!(await verifySecondFactor(userId, factor))) throw badRequest('Invalid authentication code');
  await db.transaction(async (trx) => {
    await trx('users').where({ id: userId }).update({
      mfa_enabled: false,
      mfa_secret_encrypted: null,
      mfa_pending_secret_encrypted: null,
      mfa_last_used_step: null,
      mfa_enabled_at: null,
    });
    await trx('mfa_recovery_codes').where({ user_id: userId }).delete();
  });
  await audit({ action: 'auth.mfa_disabled', userId, actorId: userId, req });
}

export async function regenerateRecoveryCodes(userId: string, code: string, req?: Request): Promise<string[]> {
  if ((await verifySecondFactor(userId, { code })) !== 'totp') throw badRequest('Invalid authentication code');
  const codes = await replaceRecoveryCodes(userId);
  await audit({ action: 'auth.mfa_recovery_regenerated', userId, actorId: userId, req });
  return codes;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const [{ count }] = await db('mfa_recovery_codes').where({ user_id: userId }).whereNull('used_at').count({ count: '*' });
  return Number(count);
}

/** Issues a short-lived challenge token after the password step of an MFA login. */
export async function createMfaChallenge(userId: string): Promise<string> {
  const token = randomToken(32);
  await createAuthToken(userId, 'mfa_challenge', token, config.MFA_CHALLENGE_TTL_SECONDS);
  return token;
}

export async function completeMfaLogin(
  mfaToken: string,
  factor: { code?: string; recoveryCode?: string },
  req?: Request,
): Promise<LoginResult> {
  const challenge = await db('auth_tokens')
    .where({ purpose: 'mfa_challenge', token_hash: sha256(mfaToken) })
    .whereNull('consumed_at')
    .where('expires_at', '>', db.fn.now())
    .first();
  if (!challenge) throw unauthorized('Sign-in session expired. Please sign in again.', 'MFA_CHALLENGE_EXPIRED');
  if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await db('auth_tokens').where({ id: challenge.id }).update({ consumed_at: db.fn.now() });
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Please sign in again.');
  }
  const method = await verifySecondFactor(challenge.userId, factor);
  if (!method) {
    await db('auth_tokens').where({ id: challenge.id }).increment('attempts', 1);
    await recordLoginEvent(req, { userId: challenge.userId, success: false, reason: 'bad_mfa_code', method: 'mfa' });
    throw unauthorized('Invalid authentication code', 'INVALID_MFA_CODE');
  }
  await db('auth_tokens').where({ id: challenge.id }).update({ consumed_at: db.fn.now() });
  if (method === 'recovery') {
    await audit({ action: 'auth.mfa_recovery_code_used', userId: challenge.userId, actorId: challenge.userId, req });
  }
  return completeLogin(challenge.userId, req, method === 'totp' ? 'password+totp' : 'password+recovery');
}
