import pino from 'pino';
import { config, isProduction, isTest } from '../config/env';

/**
 * Structured JSON logger. Sensitive values are redacted before they are
 * written so that tokens, passwords and cookies never reach log storage.
 */
export const logger = pino({
  level: isTest ? 'silent' : config.LOG_LEVEL,
  base: { service: 'monetra-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.code',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  transport:
    !isProduction && !isTest && process.stdout.isTTY
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
