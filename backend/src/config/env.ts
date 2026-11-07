import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the backend folder first, then the repository root.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_NAME: z.string().default('Monetra'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1).default('postgres://monetra:monetra@localhost:5432/monetra'),
    TEST_DATABASE_URL: z.string().optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DATABASE_SSL: bool.default(false),

    REDIS_URL: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-0123456789'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    // 32-byte key, base64 encoded. Used for AES-256-GCM field-level encryption.
    DATA_ENCRYPTION_KEY: z.string().default('ZGV2LW9ubHktZGF0YS1rZXktY2hhbmdlLW1lLTAxMjM='),
    // Secret used to build deterministic lookup hashes (e.g. phone numbers).
    HASH_PEPPER: z.string().min(16).default('dev-only-hash-pepper-change-me'),
    COOKIE_SECURE: bool.default(false),
    COOKIE_DOMAIN: z.string().optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1500),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('Monetra <no-reply@monetra.local>'),

    SMS_PROVIDER: z.enum(['console', 'webhook']).default('console'),
    SMS_WEBHOOK_URL: z.string().url().optional(),
    SMS_WEBHOOK_TOKEN: z.string().optional(),

    UPLOAD_DIR: z.string().default('./storage/uploads'),
    REPORT_DIR: z.string().default('./storage/reports'),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(5),

    MARKET_DATA_PROVIDER: z.enum(['none', 'amfi']).default('none'),
    AMFI_NAV_URL: z.string().url().default('https://www.amfiindia.com/spages/NAVAll.txt'),

    JOBS_ENABLED: bool.default(true),
    JOBS_MODE: z.enum(['bullmq', 'inline']).default('inline'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    const devDefaults: Array<[keyof typeof cfg, string]> = [
      ['JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-0123456789'],
      ['DATA_ENCRYPTION_KEY', 'ZGV2LW9ubHktZGF0YS1rZXktY2hhbmdlLW1lLTAxMjM='],
      ['HASH_PEPPER', 'dev-only-hash-pepper-change-me'],
    ];
    for (const [key, value] of devDefaults) {
      if (cfg[key] === value) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be set to a unique secret in production` });
      }
    }
    if (!cfg.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE must be true in production' });
    }
  })
  .superRefine((cfg, ctx) => {
    const key = Buffer.from(cfg.DATA_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'DATA_ENCRYPTION_KEY must be a base64 encoded 32-byte key',
      });
    }
  });

export type AppConfig = z.infer<typeof schema>;

function load(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'test' && cfg.TEST_DATABASE_URL) {
    cfg.DATABASE_URL = cfg.TEST_DATABASE_URL;
  }
  return cfg;
}

export const config = load();

export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const corsOrigins = config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
