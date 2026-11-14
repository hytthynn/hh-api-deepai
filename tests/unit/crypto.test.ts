import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  decrypt,
  encrypt,
  encryptionKey,
  generateApiKey,
  hashApiKey,
  isEncrypted,
  keyPepper,
  safeEqual,
  sha256Hex,
} from '@/src/lib/crypto';
import { env } from '@/src/lib/config';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

describe('crypto: AES-256-GCM settings payloads', () => {
  it('round-trips ASCII, unicode and empty strings', () => {
    for (const plain of ['', 'hh-api-secret', 'пароль-Ключ-🔐', 'x'.repeat(4096)]) {
      const payload = encrypt(plain);
      expect(payload.startsWith('v1.')).toBe(true);
      expect(payload.split('.')).toHaveLength(4);
      expect(isEncrypted(payload)).toBe(true);
      expect(decrypt(payload)).toBe(plain);
    }
  });

  it('uses a fresh IV per call but the same key', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('rejects a payload with a tampered auth tag', () => {
    const parts = encrypt('cookies=secret').split('.');
    const tag = Buffer.from(parts[2] ?? '', 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    const broken = `v1.${parts[1]}.${tag.toString('base64')}.${parts[3]}`;
    expect(() => decrypt(broken)).toThrow();
  });

  it('rejects a payload with tampered ciphertext', () => {
    const parts = encrypt('machine-id').split('.');
    const ct = Buffer.from(parts[3] ?? '', 'base64');
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    const broken = `v1.${parts[1]}.${parts[2]}.${ct.toString('base64')}`;
    expect(() => decrypt(broken)).toThrow();
  });

  it('rejects unknown versions and malformed payloads', () => {
    expect(() => decrypt('v2.a.b.c')).toThrow(/unsupported payload format/);
    expect(() => decrypt('v1.only-three')).toThrow(/unsupported payload format/);
  });

  it('derives the key deterministically from HH_SECRET', () => {
    const expected = scryptSync(env.secret, 'hh-api-v1', 32, SCRYPT);
    const pepper = scryptSync(env.secret, 'hh-api-pepper', 32, SCRYPT);
    expect(encryptionKey().equals(expected)).toBe(true);
    expect(keyPepper().equals(pepper)).toBe(true);
    expect(encryptionKey().equals(keyPepper())).toBe(false);
  });
});

describe('crypto: API key material', () => {
  it('generates keys matching ^hh-api-[A-Za-z0-9]{48}$', () => {
    for (let i = 0; i < 50; i += 1) {
      const key = generateApiKey();
      expect(key).toMatch(API_KEY_PATTERN);
      expect(key.length).toBe('hh-api-'.length + 48);
    }
  });

  it('hashes keys with a per-install pepper and never returns the raw key', () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(key);
    expect(hashApiKey(key)).toBe(hash);
    expect(hashApiKey(generateApiKey())).not.toBe(hash);
    expect(hash).not.toBe(sha256Hex(key));
  });

  it('compares with timingSafeEqual semantics', () => {
    expect(safeEqual('hh-api-abc', 'hh-api-abc')).toBe(true);
    expect(safeEqual('hh-api-abc', 'hh-api-abd')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});