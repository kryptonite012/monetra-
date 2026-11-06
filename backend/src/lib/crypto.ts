import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { config, isTest } from '../config/env';

// ---------------------------------------------------------------------------
// Password hashing (scrypt, memory-hard). Format: scrypt$N$r$p$salt$hash
// ---------------------------------------------------------------------------

const SCRYPT = isTest ? { N: 2 ** 12, r: 8, p: 1 } : { N: 2 ** 15, r: 8, p: 1 };
const KEY_LEN = 64;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function passwordNeedsRehash(stored: string): boolean {
  const [, N, r, p] = stored.split('$');
  return Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p;
}

/** A pre-computed hash used to equalise timing when an account does not exist. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

// ---------------------------------------------------------------------------
// Field-level encryption at rest (AES-256-GCM). Format: v1.iv.tag.ciphertext
// ---------------------------------------------------------------------------

const ENC_VERSION = 'v1';
const encKey = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64');

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.');
  if (version !== ENC_VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error('Unsupported ciphertext format');
  }
  const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Tokens and hashes
// ---------------------------------------------------------------------------

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Random numeric code (e.g. phone verification). */
export function randomDigits(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed, deterministic hash for looking up encrypted values (e.g. phone uniqueness). */
export function lookupHash(value: string): string {
  return createHmac('sha256', config.HASH_PEPPER).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
