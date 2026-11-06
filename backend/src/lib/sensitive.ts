import { z } from 'zod';

/** Field names that must never be accepted, even by accident. */
const FORBIDDEN_KEYS = /^(cvv|cvc|cvv2|pin|upipin|upi_pin|mpin|otp|password|cardnumber|card_number|pan|netbankingpassword|ipin)$/i;
/** Runs of 13-19 digits, optionally separated by spaces or dashes. */
const DIGIT_RUN = /\d(?:[ -]?\d){12,18}/g;

/** Luhn checksum used by every payment card number. */
export function luhnValid(digits: string): boolean {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

/** True when the text contains something that looks like a full card number (13-19 digits, Luhn-valid). */
export function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

/** Long digit runs (9+) in free text usually mean a full bank account number was typed. */
export const looksLikeAccountNumber = (text: string) => /\d{9,}/.test(text.replace(/[ -]/g, ''));

/**
 * Rejects payloads that contain secrets Monetra must never store
 * (card numbers, CVVs, UPI PINs, OTPs, banking passwords).
 */
export function assertNoSensitiveData(value: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (containsCardNumber(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Do not enter full card or account numbers; use the last 4 digits only' });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSensitiveData(v, ctx, [...path, i]));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(k)) {
        ctx.addIssue({ code: 'custom', path: [...path, k], message: 'Monetra never stores PINs, CVVs, OTPs or banking passwords' });
      } else {
        assertNoSensitiveData(v, ctx, [...path, k]);
      }
    }
  }
}

/** Wraps a schema so that sensitive data is rejected before normal validation. */
export function guarded<T extends z.ZodType>(schema: T) {
  return z.unknown().superRefine((v, ctx) => assertNoSensitiveData(v, ctx)).pipe(schema);
}
