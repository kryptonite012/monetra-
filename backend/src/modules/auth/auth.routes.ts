import { apiRouter } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { loginSchema, registerSchema } from './auth.schemas';
import { completeLogin, loadUserWithProfile, login, register } from './auth.service';
import { setRefreshCookie } from './session.service';

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

r.get('/me', {
  summary: 'Current user',
  handler: async ({ user }) => {
    const me = await loadUserWithProfile(user.id);
    if (!me) throw notFound('User');
    return me;
  },
});

export default r.router;
