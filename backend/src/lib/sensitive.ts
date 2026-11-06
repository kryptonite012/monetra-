import { z } from 'zod';

/** Field names that must never be accepted, even by accident. */
const FORBIDDEN_KEYS = /^(cvv|cvc|cvv2|pin|upipin|upi_pin|mpin|otp|password|cardnumber|card_number|pan|netbankingpassword|ipin)$/i;
/** 12-19 consecutive digits (optionally spaced) looks like a full card number. */
const CARD_NUMBER = /(?:\d[ -]?){12,19}/;

/**
 * Rejects payloads that contain secrets Monetra must never store
 * (card numbers, CVVs, UPI PINs, OTPs, banking passwords).
 */
export function assertNoSensitiveData(value: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (CARD_NUMBER.test(value)) {
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
