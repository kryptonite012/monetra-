import type { Request } from 'express';
import { db, withTransaction } from '../../db/knex';
import { sha256 } from '../../lib/crypto';
import { unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { audit } from '../audit/audit.service';
import { issueSession, type IssuedSession } from './session.service';

/**
 * A rotated token presented again within this window is treated as benign: two tabs refreshing at
 * once, or a page reload that interrupted the previous refresh before the browser stored the new
 * cookie. It mints a fresh token in the same family instead of signing the user out. After the
 * window, reuse is treated as theft and the whole family is revoked.
 */
const ROTATION_GRACE_MS = 30_000;

type ReuseHook = (userId: string, req?: Request) => Promise<void>;
let onReuseDetected: ReuseHook | undefined;

/** Lets other modules (notifications) react when refresh-token reuse is detected. */
export function setRefreshReuseHook(hook: ReuseHook): void {
  onReuseDetected = hook;
}

/**
 * Exchanges a refresh token for a new access/refresh pair (rotation).
 * Presenting an already-rotated token revokes the whole token family,
 * which shuts out an attacker holding a stolen refresh token.
 */
export async function rotateRefreshToken(refreshToken: string, req?: Request): Promise<IssuedSession> {
  const tokenHash = sha256(refreshToken);

  const outcome = await withTransaction(async (trx) => {
    const session = await trx('sessions').where({ token_hash: tokenHash }).forUpdate().first();
    if (!session) return { kind: 'invalid' as const };

    if (session.revokedAt) {
      if (session.revokedReason === 'rotated') {
        const rotatedAgo = Date.now() - new Date(session.revokedAt).getTime();
        if (rotatedAgo < ROTATION_GRACE_MS) {
          const familyAlive = await trx('sessions').where({ family_id: session.familyId }).whereNull('revoked_at').first('id');
          const user = await trx('users').where({ id: session.userId }).first();
          if (!familyAlive || !user || user.status !== 'active' || user.deletedAt) return { kind: 'invalid' as const };
          const sibling = await issueSession({ id: user.id, email: user.email, role: user.role }, req, { familyId: session.familyId, parentId: session.id }, trx);
          return { kind: 'ok' as const, session: sibling };
        }
        await trx('sessions')
          .where({ family_id: session.familyId })
          .whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now(), revoked_reason: 'reuse_detected' });
        return { kind: 'reuse' as const, userId: session.userId as string, familyId: session.familyId as string };
      }
      return { kind: 'invalid' as const };
    }
    if (new Date(session.expiresAt) < new Date()) return { kind: 'invalid' as const };

    const user = await trx('users').where({ id: session.userId }).first();
    if (!user || user.status !== 'active' || user.deletedAt) return { kind: 'invalid' as const };

    const next = await issueSession(
      { id: user.id, email: user.email, role: user.role },
      req,
      { familyId: session.familyId, parentId: session.id },
      trx,
    );
    await trx('sessions')
      .where({ id: session.id })
      .update({ revoked_at: trx.fn.now(), revoked_reason: 'rotated', replaced_by_id: next.sessionId, last_used_at: trx.fn.now() });
    return { kind: 'ok' as const, session: next };
  });

  switch (outcome.kind) {
    case 'ok':
      return outcome.session;
    case 'reuse':
      logger.warn({ userId: outcome.userId, familyId: outcome.familyId }, 'refresh token reuse detected');
      await audit({ action: 'auth.refresh_reuse_detected', userId: outcome.userId, actorId: null, entityType: 'session_family', entityId: outcome.familyId, req });
      await onReuseDetected?.(outcome.userId, req);
      throw unauthorized('Session has been revoked for your security. Please sign in again.', 'SESSION_REVOKED');
    default:
      throw unauthorized('Session has expired, please sign in again', 'SESSION_EXPIRED');
  }
}

/** Revokes the session that owns a refresh token (logout). Returns the user id if found. */
export async function revokeByRefreshToken(refreshToken: string): Promise<string | null> {
  const [row] = await db('sessions')
    .where({ token_hash: sha256(refreshToken) })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(), revoked_reason: 'logout' })
    .returning(['user_id', 'id']);
  return row ? (row.userId as string) : null;
}
