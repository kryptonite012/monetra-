import { createHmac, randomBytes } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238) on top of HOTP (RFC 4226),
 * compatible with Google Authenticator, Microsoft Authenticator, Authy, etc.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totp(secret: string, now = Date.now()): string {
  return hotp(secret, currentStep(now));
}

/**
 * Verifies a code allowing ±`window` steps of clock drift. Returns the matched
 * time step (used to block replays of the same code) or null.
 */
export function verifyTotp(secret: string, code: string, opts: { window?: number; now?: number; afterStep?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const window = opts.window ?? 1;
  const step = currentStep(opts.now);
  for (let i = -window; i <= window; i++) {
    const candidate = step + i;
    if (opts.afterStep !== undefined && candidate <= opts.afterStep) continue;
    if (hotp(secret, candidate) === code) return candidate;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'Monetra'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
