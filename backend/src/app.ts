import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { genRequestId } from './middleware/request-id';
import {
  corsPolicy,
  csrfProtect,
  issueCsrfToken,
  noStore,
  rateLimiters,
  securityHeaders,
  type RateLimitOptions,
} from './middleware/security';
import { apiV1 } from './routes';
import { isTest } from './config/env';

export interface AppOptions {
  rateLimit?: RateLimitOptions;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: genRequestId,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'monetra-api', time: new Date().toISOString() });
  });

  // Tests exercise many sign-ins from one IP, so they use generous limits unless told otherwise.
  const limits = rateLimiters(options.rateLimit ?? (isTest ? { apiMax: 100_000, authMax: 100_000 } : {}));
  app.use('/api', noStore, limits.api);
  const authLimited = ['/login', '/login/mfa', '/register', '/password/forgot', '/password/reset', '/verify-phone/request', '/verify-phone/confirm'];
  app.use(authLimited.map((p) => `/api/v1/auth${p}`), limits.auth);
  app.get('/api/v1/auth/csrf', issueCsrfToken);
  app.use(['/api/v1/auth/refresh', '/api/v1/auth/logout'], csrfProtect);

  app.use('/api/v1', apiV1());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
