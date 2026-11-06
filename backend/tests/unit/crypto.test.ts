import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  hashPassword,
  lookupHash,
  passwordNeedsRehash,
  randomDigits,
  randomToken,
  sha256,
  verifyPassword,
} from '../../src/lib/crypto';
import { checkPassword } from '../../src/lib/password-policy';

describe('password hashing', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('Correct-Horse-9');
    const b = await hashPassword('Correct-Horse-9');
    expect(a).not.toEqual(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Correct-Horse-9', a)).toBe(true);
    expect(await verifyPassword('correct-horse-9', a)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(passwordNeedsRehash(a)).toBe(false);
    expect(passwordNeedsRehash('scrypt$1024$8$1$aa$bb')).toBe(true);
  });
});

describe('field encryption', () => {
  it('round-trips and authenticates ciphertext', () => {
    const ct = encrypt('+919876543210');
    expect(ct).not.toContain('9876543210');
    expect(decrypt(ct)).toBe('+919876543210');
    const parts = ct.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});

describe('tokens', () => {
  it('generates unpredictable tokens and stable hashes', () => {
    expect(randomToken()).not.toEqual(randomToken());
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(sha256('abc')).toHaveLength(64);
    expect(lookupHash('x')).toEqual(lookupHash('x'));
  });
});

describe('password policy', () => {
  it('accepts strong and rejects weak passwords', () => {
    expect(checkPassword('Monsoon#Ledger42').ok).toBe(true);
    expect(checkPassword('short1A').ok).toBe(false);
    expect(checkPassword('alllowercaseletters').ok).toBe(false);
    expect(checkPassword('Password123').ok).toBe(false);
    expect(checkPassword('password123').ok).toBe(false);
    expect(checkPassword('Priya@2026Budget', { name: 'Priya Sharma' }).ok).toBe(false);
    expect(checkPassword('Ravi.kumar#991', { email: 'ravi.kumar@example.in' }).ok).toBe(false);
  });
});
