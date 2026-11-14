import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from './config';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

function derive(password: string, salt: string, length = 32): Buffer {
  return scryptSync(password, salt, length, SCRYPT);
}

let cachedKey: Buffer | null = null;
let cachedPepper: Buffer | null = null;

export function encryptionKey(): Buffer {
  cachedKey ??= derive(env.secret, 'hh-api-v1');
  return cachedKey;
}

export function keyPepper(): Buffer {
  cachedPepper ??= derive(env.secret, 'hh-api-pepper');
  return cachedPepper;
}

/** AES-256-GCM, format: v1.<iv_b64>.<tag_b64>.<ct_b64> */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('decrypt: unsupported payload format');
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ct = Buffer.from(parts[3] ?? '', 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*$/.test(value);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Base64Url(input: string, secret: string = env.secret): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    const chunk = randomBytes(length * 2);
    for (const byte of chunk) {
      if (byte >= 248) continue;
      out += ALPHABET[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export const API_KEY_PREFIX = 'hh-api-';
export const API_KEY_BODY_LENGTH = 48;
export const API_KEY_PATTERN = /^hh-api-[A-Za-z0-9]{48}$/;

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBase62(API_KEY_BODY_LENGTH);
}

export function hashApiKey(key: string, pepper: Buffer = keyPepper()): string {
  return createHash('sha256').update(pepper).update(key, 'utf8').digest('hex');
}

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('base64');
  const hash = scryptSync(password, salt, 32, SCRYPT).toString('base64');
  return `scrypt$${salt}$${hash}`;
}

export function passwordVerify(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1] ?? '';
  const expected = parts[2] ?? '';
  const actual = scryptSync(password, salt, 32, SCRYPT).toString('base64');
  return safeEqual(actual, expected);
}