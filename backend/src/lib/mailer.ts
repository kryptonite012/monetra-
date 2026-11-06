import nodemailer, { type Transporter } from 'nodemailer';
import { config, isTest } from '../config/env';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Messages captured in test mode so integration tests can assert on them. */
export const testOutbox: MailMessage[] = [];

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter || !config.SMTP_HOST) return transporter;
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Wraps content in Monetra's minimal, client-safe email layout. */
export function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#0f766e;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8;padding:24px;color:#0f172a">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 18px">${escapeHtml(title)}</h1>${body}${button}
<p style="font-size:12px;color:#64748b;margin-top:28px">You are receiving this because of activity on your ${escapeHtml(config.APP_NAME)} account. Monetra will never ask for your bank password, UPI PIN, card CVV or OTPs.</p>
</div></body></html>`;
}

/** Sends an email via SMTP, or logs it when SMTP is not configured (development). */
export async function sendMail(message: MailMessage): Promise<void> {
  if (isTest) {
    testOutbox.push(message);
    return;
  }
  const t = getTransporter();
  if (!t) {
    logger.info({ to: message.to, subject: message.subject, text: message.text }, 'email (SMTP not configured, logged only)');
    return;
  }
  try {
    await t.sendMail({ from: config.MAIL_FROM, ...message });
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, 'email delivery failed');
  }
}
