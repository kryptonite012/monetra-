import Redis from 'ioredis';
import { config, isTest } from '../config/env';
import { logger } from './logger';

let client: Redis | null | undefined;

/** Shared Redis connection, or null when REDIS_URL is not configured (and always in tests). */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!config.REDIS_URL || isTest) {
    client = null;
    return client;
  }
  client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, enableOfflineQueue: true });
  client.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}
