import cors from 'cors';
import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import helmet from 'helmet';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { config, corsOrigins, isProduction } from '../config/env';
import { randomToken, safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { getRedis } from '../lib/redis';

/** Strict security headers for a JSON API. */
export const securityHeaders = helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: isProduction ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
});

export const corsPolicy = cors({
  origin(origin, cb) {
    // Same-origin and non-browser requests carry no Origin header.
    if (!origin || corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
  maxAge: 600,
});

/** Financial data must never be stored by browsers or intermediary caches. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

function limiter(prefix: string, limit: number, extra: Partial<Options> = {}) {
  const redis = getRedis();
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: redis
      ? new RedisStore({
          prefix: `rl:${prefix}:`,
          sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
        })
      : undefined,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down and try again later')),
    ...extra,
  });
}

export interface RateLimitOptions {
  apiMax?: number;
  authMax?: number;
}

export function rateLimiters(opts: RateLimitOptions = {}) {
  return {
    api: limiter('api', opts.apiMax ?? config.RATE_LIMIT_MAX),
    // Credential endpoints get a much tighter budget per client IP.
    auth: limiter('auth', opts.authMax ?? config.AUTH_RATE_LIMIT_MAX, { skipSuccessfulRequests: false }),
  };
}

// ---------------------------------------------------------------------------
// CSRF: double-submit cookie for the endpoints authenticated by cookies
// (refresh and logout). All other endpoints use Bearer tokens.
// ---------------------------------------------------------------------------

export const CSRF_COOKIE = 'monetra_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const issueCsrfToken: RequestHandler = (req, res) => {
  const existing = req.cookies?.[CSRF_COOKIE];
  const token = typeof existing === 'string' && existing.length >= 32 ? existing : randomToken(24);
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    domain: config.COOKIE_DOMAIN,
  });
  res.json({ data: { csrfToken: token } });
};

export const csrfProtect: RequestHandler = (req, _res, next) => {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || !header || !safeEqual(cookie, header)) {
    throw new AppError(403, 'CSRF_FAILED', 'Security token missing or invalid. Refresh the page and try again.');
  }
  next();
};
