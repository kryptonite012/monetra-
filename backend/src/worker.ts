/* Background worker entry point: node dist/worker.js (JOBS_MODE=bullmq) */
import { config } from './config/env';
import { logger } from './lib/logger';
import { registerNotificationHooks } from './modules/notifications/hooks';
import './modules/income/income.routes';
import './modules/expenses/expenses.routes';
import { scheduleBullJobs, startBullWorker, startInlineScheduler } from './jobs/scheduler';

async function main() {
  registerNotificationHooks();
  if (config.JOBS_MODE === 'bullmq') {
    await scheduleBullJobs();
    const worker = startBullWorker();
    const stop = async () => {
      await worker.close();
      process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    logger.info('Monetra worker running (BullMQ)');
  } else {
    startInlineScheduler();
    logger.info('Monetra worker running (inline scheduler)');
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
