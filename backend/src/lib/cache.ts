import { logger } from './logger';
import { getRedis } from './redis';

/**
 * Per-user read cache backed by Redis. Every ledger write bumps the user's
 * cache version, so cached aggregates are invalidated immediately instead of
 * waiting for the TTL. Without Redis the functions simply compute.
 */
const versionKey = (userId: string) => `cache:v:${userId}`;

export function bumpUserCache(userId: string): void {
  const redis = getRedis();
  if (!redis) return;
  redis.incr(versionKey(userId)).catch((err) => logger.warn({ err: err.message }, 'cache bump failed'));
}

export async function cachedForUser<T>(userId: string, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return compute();
  try {
    const version = (await redis.get(versionKey(userId))) ?? '0';
    const fullKey = `cache:${userId}:${version}:${key}`;
    const hit = await redis.get(fullKey);
    if (hit) return JSON.parse(hit) as T;
    const value = await compute();
    await redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'cache unavailable, computing directly');
    return compute();
  }
}
