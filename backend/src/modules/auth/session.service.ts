import { randomUUID } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../../config/env';
import { db, type Db } from '../../db/knex';
import { randomToken, sha256 } from '../../lib/crypto';
import type { Role } from '../../types/auth';
import { clientInfo } from '../audit/audit.service';
import { signAccessToken } from './tokens';

export const REFRESH_COOKIE = 'monetra_rt';
const REFRESH_PATH = '/api/v1/auth';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** Creates a session row (refresh token hashed at rest) and issues an access token bound to it. */
export async function issueSession(
  user: SessionUser,
  req: Request | undefined,
  opts: { familyId?: string; parentId?: string } = {},
  conn: Db = db,
): Promise<IssuedSession> {
  const refreshToken = randomToken(48);
  const { ip, userAgent } = clientInfo(req);
  const familyId = opts.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const [row] = await conn('sessions')
    .insert({
      user_id: user.id,
      family_id: familyId,
      parent_id: opts.parentId ?? null,
      token_hash: sha256(refreshToken),
      ip,
      user_agent: userAgent,
      device_label: describeDevice(userAgent),
      expires_at: expiresAt,
    })
    .returning(['id']);
  const access = signAccessToken({ sub: user.id, sid: row.id, role: user.role, email: user.email });
  return { sessionId: row.id, familyId, refreshToken, accessToken: access.token, expiresIn: access.expiresIn };
}

export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_PATH,
    domain: config.COOKIE_DOMAIN,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

export async function revokeSession(sessionId: string, reason: string, conn: Db = db): Promise<void> {
  await conn('sessions').where({ id: sessionId }).whereNull('revoked_at').update({ revoked_at: conn.fn.now(), revoked_reason: reason });
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string, conn: Db = db): Promise<number> {
  const q = conn('sessions').where({ user_id: userId }).whereNull('revoked_at');
  if (exceptSessionId) q.whereNot({ id: exceptSessionId });
  return q.update({ revoked_at: conn.fn.now(), revoked_reason: reason });
}
