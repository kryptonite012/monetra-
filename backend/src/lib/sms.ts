import { config, isTest } from '../config/env';
import { logger } from './logger';

export interface SmsMessage {
  to: string;
  body: string;
}

export const testSmsOutbox: SmsMessage[] = [];

/**
 * SMS delivery for phone verification.
 * - console: development only; the message is written to the server log.
 * - webhook: POSTs { to, body } to SMS_WEBHOOK_URL so any licensed SMS gateway
 *   (MSG91, Twilio, Gupshup, ...) can be plugged in through a small relay.
 */
export async function sendSms(message: SmsMessage): Promise<void> {
  if (isTest) {
    testSmsOutbox.push(message);
    return;
  }
  if (config.SMS_PROVIDER === 'webhook' && config.SMS_WEBHOOK_URL) {
    const res = await fetch(config.SMS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${config.SMS_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'sms webhook rejected message');
      throw new Error('SMS delivery failed');
    }
    return;
  }
  logger.info({ to: `***${message.to.slice(-4)}`, body: message.body }, 'sms (console provider)');
}
