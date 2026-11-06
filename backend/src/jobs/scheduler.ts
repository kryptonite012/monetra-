import { Queue, Worker } from 'bullmq';
import { config } from '../config/env';
import { db } from '../db/knex';
import { logger } from '../lib/logger';
import { runAllTasks } from './tasks';

const QUEUE = 'monetra-maintenance';
const LOCK_KEY = 74_821_001; // pg advisory lock id shared by all instances
const EVERY_MS = 15 * 60 * 1000;

/** Runs the task batch only if no other instance holds the advisory lock. */
export async function runWithLock(): Promise<boolean> {
  const conn = await db.client.acquireConnection();
  try {
    const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    if (!rows[0].locked) return false;
    try {
      await runAllTasks();
    } finally {
      await conn.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
    return true;
  } finally {
    await db.client.releaseConnection(conn);
  }
}

let timer: NodeJS.Timeout | null = null;

/** In-process scheduler for single-node and local setups. */
export function startInlineScheduler(): void {
  if (timer) return;
  const tick = () => runWithLock().catch((err) => logger.error({ err }, 'scheduled run failed'));
  setTimeout(tick, 10_000).unref();
  timer = setInterval(tick, EVERY_MS);
  timer.unref();
  logger.info({ everyMinutes: EVERY_MS / 60_000 }, 'inline job scheduler started');
}

export function stopInlineScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function connection() {
  if (!config.REDIS_URL) throw new Error('JOBS_MODE=bullmq requires REDIS_URL');
  const url = new URL(config.REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined, username: url.username || undefined, maxRetriesPerRequest: null };
}

/** Registers the repeatable maintenance job (call from the API or the worker). */
export async function scheduleBullJobs(): Promise<Queue> {
  const queue = new Queue(QUEUE, { connection: connection() });
  await queue.upsertJobScheduler('maintenance-every-15m', { every: EVERY_MS }, { name: 'run-all', opts: { removeOnComplete: 100, removeOnFail: 200 } });
  logger.info('BullMQ maintenance schedule registered');
  return queue;
}

/** Dedicated worker process for JOBS_MODE=bullmq (see src/worker.ts). */
export function startBullWorker(): Worker {
  const worker = new Worker(QUEUE, async () => (await runWithLock()) ? 'ran' : 'skipped (locked)', { connection: connection(), concurrency: 1 });
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'maintenance job failed'));
  worker.on('completed', (job, result) => logger.info({ jobId: job.id, result }, 'maintenance job completed'));
  return worker;
}
