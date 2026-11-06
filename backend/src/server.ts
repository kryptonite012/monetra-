import { createApp } from './app';
import { config } from './config/env';
import { closeDb } from './db/knex';
import { startInlineScheduler, stopInlineScheduler } from './jobs/scheduler';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Monetra API listening');
  // With JOBS_MODE=bullmq the separate worker process runs jobs instead.
  if (config.JOBS_ENABLED && config.JOBS_MODE === 'inline') startInlineScheduler();
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopInlineScheduler();
  server.close(async () => {
    await Promise.allSettled([closeDb(), closeRedis()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
