import { z } from 'zod';

// A short deny-list of the most common passwords; the length + variety rules do most of the work.
const COMMON = new Set([
  'password', 'password1', 'password123', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou',
  'welcome123', 'admin12345', 'letmein123', 'monkey1234', 'india12345', 'abcd123456', 'passw0rd123', 'monetra123',
]);

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/** Checks a password against Monetra's policy (length, character variety, common/derived passwords). */
export function checkPassword(password: string, context: { email?: string; name?: string } = {}): PasswordCheck {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters');
  if (password.length > 128) problems.push('Use at most 128 characters');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) problems.push('Mix at least three of: lowercase, uppercase, digits and symbols');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push('This password is too common');
  if (/(.)\1{3,}/.test(password)) problems.push('Avoid repeating the same character');
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) problems.push('Do not include your email address');
  const first = context.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) problems.push('Do not include your name');
  return { ok: problems.length === 0, problems };
}

export const passwordSchema = z
  .string()
  .min(1, 'Password is required')
  .max(128)
  .superRefine((value, ctx) => {
    const res = checkPassword(value);
    for (const p of res.problems) ctx.addIssue({ code: 'custom', message: p });
  });
