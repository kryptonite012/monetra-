import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { config } from '../../config/env';
import { db } from '../../db/knex';
import { snakeKeys } from '../../db/case';
import { decrypt, verifyPassword } from '../../lib/crypto';
import { badRequest, unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { layout, sendMail } from '../../lib/mailer';
import { verifyTotp } from '../../lib/totp';
import { audit } from '../audit/audit.service';
import { loadUserWithProfile } from '../auth/auth.service';

export async function updateProfile(userId: string, patch: Record<string, unknown>, req?: Request) {
  if (Object.keys(patch).length) {
    await db('user_profiles').where({ user_id: userId }).update(snakeKeys(patch));
    await audit({ action: 'user.profile_updated', userId, req, metadata: { fields: Object.keys(patch) } });
  }
  return loadUserWithProfile(userId);
}

export async function updatePreferences(userId: string, patch: Record<string, unknown>) {
  const row = await db('user_profiles').where({ user_id: userId }).first('preferences');
  const current = (row?.preferences ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const prev = current[key];
    merged[key] =
      value && typeof value === 'object' && prev && typeof prev === 'object' ? { ...(prev as object), ...(value as object) } : value;
  }
  await db('user_profiles').where({ user_id: userId }).update({ preferences: JSON.stringify(merged) });
  return merged;
}

/** Tables that hold credentials or token hashes are never exported. */
const EXPORT_EXCLUDED = new Set(['sessions', 'auth_tokens', 'mfa_recovery_codes', 'users']);
const REDACTED_COLUMN = /(_encrypted|_hash|password)$/i;

/**
 * Builds a machine-readable export of everything stored about the user.
 * Tables are discovered dynamically (every table with a user_id column).
 */
export async function exportUserData(userId: string) {
  const user = await db('users').where({ id: userId }).first();
  const { rows: tables } = await db.raw<{ rows: Array<{ tableName: string }> }>(
    `SELECT DISTINCT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY table_name`,
  );
  const data: Record<string, unknown[]> = {};
  for (const { tableName } of tables) {
    if (EXPORT_EXCLUDED.has(tableName)) continue;
    const rows: Record<string, unknown>[] = await db(tableName).where({ user_id: userId });
    data[tableName] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !REDACTED_COLUMN.test(k))));
  }
  return {
    exportedAt: new Date().toISOString(),
    format: 'monetra-export/v1',
    account: {
      id: user.id,
      email: user.email,
      phone: user.phoneEncrypted ? decrypt(user.phoneEncrypted) : null,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
    },
    data,
  };
}

/** Removes stored files that belong to the user (receipts, generated reports). */
async function removeUserFiles(userId: string): Promise<void> {
  for (const dir of [config.UPLOAD_DIR, config.REPORT_DIR]) {
    const target = path.resolve(dir, userId);
    await fs.rm(target, { recursive: true, force: true }).catch((err) => logger.warn({ err, target }, 'could not remove user files'));
  }
}

/**
 * Permanently deletes the account and all of its financial data. The ledger
 * purge flag is the only path that may delete immutable ledger rows.
 */
export async function deleteAccount(userId: string, input: { password: string; code?: string }, req?: Request) {
  const user = await db('users').where({ id: userId }).first();
  if (!(await verifyPassword(input.password, user.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  if (user.mfaEnabled) {
    if (!input.code) throw badRequest('Enter your authenticator code to confirm');
    if (verifyTotp(decrypt(user.mfaSecretEncrypted), input.code) === null) throw badRequest('Invalid authentication code');
  }
  await audit({ action: 'user.account_deleted', userId, actorId: userId, entityType: 'user', entityId: userId, req });
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL monetra.allow_ledger_purge = 'on'`);
    await trx('users').where({ id: userId }).delete();
  });
  await removeUserFiles(userId);
  await sendMail({
    to: user.email,
    subject: 'Your Monetra account has been deleted',
    text: 'Your Monetra account and all associated financial records have been permanently deleted.',
    html: layout('Account deleted', ['Your Monetra account and all associated financial records have been permanently deleted.', 'Thank you for using Monetra.']),
  });
}
