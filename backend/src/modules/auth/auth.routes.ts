import { db } from '../../db/knex';
import { apiRouter } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { z } from 'zod';
import { loginSchema, phoneSchema, registerSchema } from './auth.schemas';
import {
  confirmEmailVerification,
  confirmPhoneVerification,
  sendEmailVerification,
  sendPhoneVerification,
} from './verification.service';
import {
  completeMfaLogin,
  createMfaChallenge,
  disableMfa,
  enableMfa,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
  startMfaSetup,
} from './mfa.service';
import { completeLogin, loadUserWithProfile, login, register } from './auth.service';
import { revokeByRefreshToken, rotateRefreshToken } from './refresh.service';
import { clearRefreshCookie, REFRESH_COOKIE, revokeSession, setRefreshCookie } from './session.service';
import { verifyAccessToken } from './tokens';
import { audit } from '../audit/audit.service';
import { unauthorized } from '../../lib/errors';

const r = apiRouter('/auth', 'Auth');

r.post('/register', {
  summary: 'Create an account',
  public: true,
  status: 201,
  body: registerSchema,
  handler: async ({ body, req, res }) => {
    const userId = await register(body, req);
    await sendEmailVerification(userId);
    const result = await completeLogin(userId, req, 'registration');
    if (result.mfaRequired) throw new Error('unreachable');
    setRefreshCookie(res, result.session.refreshToken);
    return { accessToken: result.session.accessToken, expiresIn: result.session.expiresIn, user: result.user };
  },
});

r.post('/login', {
  summary: 'Sign in with email and password',
  description: 'Returns an access token (and sets an httpOnly refresh cookie) or an MFA challenge token.',
  public: true,
  body: loginSchema,
  handler: async ({ body, req, res }) => {
    const result = await login(body.email, body.password, req, createMfaChallenge);
    if (result.mfaRequired) return { mfaRequired: true, mfaToken: result.mfaToken };
    setRefreshCookie(res, result.session.refreshToken);
    return {
      mfaRequired: false,
      accessToken: result.session.accessToken,
      expiresIn: result.session.expiresIn,
      user: result.user,
    };
  },
});

const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const secondFactor = z
  .object({ code: totpCode.optional(), recoveryCode: z.string().trim().min(10).max(20).optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), 'Provide either an authenticator code or a recovery code');

r.post('/login/mfa', {
  summary: 'Complete sign-in with an authenticator or recovery code',
  public: true,
  body: z.object({ mfaToken: z.string().min(20).max(200) }).and(secondFactor),
  handler: async ({ body, req, res }) => {
    const result = await completeMfaLogin(body.mfaToken, body, req);
    if (result.mfaRequired) throw new Error('unreachable');
    setRefreshCookie(res, result.session.refreshToken);
    return { mfaRequired: false, accessToken: result.session.accessToken, expiresIn: result.session.expiresIn, user: result.user };
  },
});

r.get('/mfa', {
  summary: 'Two-factor authentication status',
  handler: async ({ user }) => {
    const row = await db('users').where({ id: user.id }).first('mfa_enabled', 'mfa_enabled_at');
    return { enabled: Boolean(row.mfaEnabled), enabledAt: row.mfaEnabledAt, recoveryCodesRemaining: await remainingRecoveryCodes(user.id) };
  },
});

r.post('/mfa/setup', {
  summary: 'Begin TOTP setup (returns secret and QR code)',
  handler: ({ user }) => startMfaSetup(user.id),
});

r.post('/mfa/enable', {
  summary: 'Confirm TOTP setup and receive one-time recovery codes',
  body: z.object({ code: totpCode }),
  handler: async ({ body, user, req }) => ({ recoveryCodes: await enableMfa(user.id, body.code, req) }),
});

r.post('/mfa/disable', {
  summary: 'Disable two-factor authentication',
  body: z.object({ password: z.string().min(1).max(128) }).and(secondFactor),
  handler: async ({ body, user, req }) => {
    await disableMfa(user.id, body.password, body, req);
    return { enabled: false };
  },
});

r.post('/mfa/recovery-codes', {
  summary: 'Regenerate recovery codes (invalidates the old ones)',
  body: z.object({ code: totpCode }),
  handler: async ({ body, user, req }) => ({ recoveryCodes: await regenerateRecoveryCodes(user.id, body.code, req) }),
});

r.post('/refresh', {
  summary: 'Rotate the refresh token and obtain a new access token',
  description: 'Uses the httpOnly refresh cookie. Reusing a rotated token revokes the entire session family.',
  public: true,
  handler: async ({ req, res }) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('No active session', 'SESSION_EXPIRED');
    try {
      const session = await rotateRefreshToken(token, req);
      setRefreshCookie(res, session.refreshToken);
      return { accessToken: session.accessToken, expiresIn: session.expiresIn };
    } catch (err) {
      if ((err as { code?: string }).code !== 'REFRESH_RACE') clearRefreshCookie(res);
      throw err;
    }
  },
});

r.post('/logout', {
  summary: 'Sign out of the current session',
  public: true,
  handler: async ({ req, res }) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    let userId: string | null = null;
    if (token) userId = await revokeByRefreshToken(token);
    const header = req.get('authorization');
    if (header?.startsWith('Bearer ')) {
      try {
        const claims = verifyAccessToken(header.slice(7));
        await revokeSession(claims.sid, 'logout');
        userId ??= claims.sub;
      } catch {
        // An expired access token is fine here: the cookie identifies the session.
      }
    }
    clearRefreshCookie(res);
    if (userId) await audit({ action: 'auth.logout', userId, actorId: userId, req });
    return undefined;
  },
});

r.post('/verify-email/request', {
  summary: 'Send (or resend) the email verification link',
  handler: async ({ user }) => {
    await sendEmailVerification(user.id);
    return { sent: true };
  },
});

r.post('/verify-email/confirm', {
  summary: 'Confirm an email address using the emailed token',
  public: true,
  body: z.object({ token: z.string().min(20).max(200) }),
  handler: async ({ body, req }) => {
    await confirmEmailVerification(body.token, req);
    return { verified: true };
  },
});

r.post('/verify-phone/request', {
  summary: 'Send a 6-digit verification code by SMS (optionally to a new number)',
  body: z.object({ phone: phoneSchema.optional() }),
  handler: async ({ body, user }) => sendPhoneVerification(user.id, body.phone),
});

r.post('/verify-phone/confirm', {
  summary: 'Confirm the SMS verification code',
  body: z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }),
  handler: async ({ body, user, req }) => {
    await confirmPhoneVerification(user.id, body.code, req);
    return { verified: true };
  },
});

r.get('/me', {
  summary: 'Current user',
  handler: async ({ user }) => {
    const me = await loadUserWithProfile(user.id);
    if (!me) throw notFound('User');
    return me;
  },
});

export default r.router;
