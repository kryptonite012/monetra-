import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUrl, totp, verifyTotp } from '../../src/lib/totp';

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world');
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    expect(hotp(RFC_SECRET, 0)).toBe('755224');
    expect(hotp(RFC_SECRET, 1)).toBe('287082');
    expect(hotp(RFC_SECRET, 9)).toBe('520489');
  });

  it('matches the RFC 6238 TOTP vectors (last 6 digits)', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('accepts one step of drift and blocks replays', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now - 30_000);
    const step = verifyTotp(RFC_SECRET, code, { now });
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { now, afterStep: step! })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 120_000), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
  });

  it('builds authenticator URLs', () => {
    expect(otpauthUrl('ABC', 'a@b.in')).toContain('otpauth://totp/Monetra%3Aa%40b.in?secret=ABC');
  });
});
