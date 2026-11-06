import type { RequestHandler } from 'express';
import { db } from '../db/knex';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../modules/auth/tokens';
import type { Role } from '../types/auth';
import '../types/auth';

/**
 * Validates the Bearer access token and confirms that its session is still
 * active and the user is enabled, so revoked sessions stop working at once.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7).trim());
  } catch {
    throw unauthorized('Access token is invalid or expired', 'TOKEN_INVALID');
  }
  const row = await db('sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.id', claims.sid)
    .andWhere('s.user_id', claims.sub)
    .first('s.revoked_at', 's.expires_at', 'u.status', 'u.role', 'u.email', 'u.deleted_at');
  if (!row || row.revokedAt || new Date(row.expiresAt) < new Date()) {
    throw unauthorized('Session has ended, please sign in again', 'SESSION_REVOKED');
  }
  if (row.status !== 'active' || row.deletedAt) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  req.user = { id: claims.sub, email: row.email, role: row.role, sessionId: claims.sid };
  next();
};

/** Restricts a route to the given roles (use after requireAuth). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}
