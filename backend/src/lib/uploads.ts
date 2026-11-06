import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config/env';
import { unprocessable } from './errors';

export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

/** In-memory upload (files are validated before anything touches the disk). */
export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.round(config.MAX_UPLOAD_MB * 1024 * 1024), files: 1, fields: 5 },
});

/** Detects the real file type from its leading bytes instead of trusting the client. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

/** Keeps a display-safe version of the client's filename (no paths or control characters). */
export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return base || 'receipt';
}

export interface StoredFile {
  storedFilename: string;
  mimeType: AllowedMime;
  sizeBytes: number;
  sha256: string;
  absolutePath: string;
}

/** Validates and writes an uploaded file into the user's private storage folder. */
export async function storeUserFile(userId: string, file: Express.Multer.File): Promise<StoredFile> {
  const mime = sniffMime(file.buffer);
  if (!mime) throw unprocessable('Only JPEG, PNG, WEBP images or PDF documents are accepted');
  if (file.mimetype && file.mimetype !== mime && !(file.mimetype === 'image/jpg' && mime === 'image/jpeg')) {
    throw unprocessable('The file content does not match its declared type');
  }
  if (mime === 'application/pdf' && /\/JavaScript|\/JS\s|\/Launch|\/EmbeddedFile/.test(file.buffer.toString('latin1'))) {
    throw unprocessable('PDFs containing scripts or embedded files are not accepted');
  }
  const dir = path.resolve(config.UPLOAD_DIR, userId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const storedFilename = `${randomBytes(16).toString('hex')}.${ALLOWED_TYPES[mime]}`;
  const absolutePath = path.join(dir, storedFilename);
  await fs.writeFile(absolutePath, file.buffer, { mode: 0o600, flag: 'wx' });
  return { storedFilename, mimeType: mime, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex'), absolutePath };
}

export function userFilePath(userId: string, storedFilename: string): string {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(storedFilename)) throw new Error('Invalid stored filename');
  return path.resolve(config.UPLOAD_DIR, userId, storedFilename);
}
