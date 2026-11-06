import { apiRouter } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { loginSchema, registerSchema } from './auth.schemas';
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
    const result = await login(body.email, body.password, req);
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

r.get('/me', {
  summary: 'Current user',
  handler: async ({ user }) => {
    const me = await loadUserWithProfile(user.id);
    if (!me) throw notFound('User');
    return me;
  },
});

export default r.router;
