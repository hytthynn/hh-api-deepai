import { beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createKey, deleteKey, findKeyByHash, getKey, listKeys } from '@/src/adapters/db/repositories/keys';
import { API_KEY_PATTERN, decrypt, encrypt, generateApiKey, hashApiKey } from '@/src/lib/crypto';
import { authenticateRequest, extractApiKey } from '@/src/server/gateway/auth';

function newKey(name = 'test', tokenLimit: number | null = null) {
  const raw = generateApiKey();
  const row = createKey({
    name,
    prefix: raw.slice(0, 11),
    last4: raw.slice(-4),
    keyHash: hashApiKey(raw),
    keyEnc: encrypt(raw),
    tokenLimit,
  });
  return { raw, row };
}

describe('keys: storage, reveal and deletion', () => {
  beforeAll(() => {
    closeDb();
    runMigrations();
  });

  it('stores the hash, prefix, last4 and ciphertext — never the plaintext', () => {
    const { raw, row } = newKey('storage');
    expect(raw).toMatch(API_KEY_PATTERN);
    expect(row.keyHash).toBe(hashApiKey(raw));
    expect(row.keyHash).not.toContain(raw);
    expect(row.prefix).toBe(raw.slice(0, 11));
    expect(row.last4).toBe(raw.slice(-4));
    expect(row.tokenLimit).toBeNull();
    const stored = JSON.stringify(getKey(row.id));
    expect(stored).not.toContain(raw);
    expect(decrypt(row.keyEnc!)).toBe(raw);
  });

  it('keeps the token quota when it is set', () => {
    const { row } = newKey('quota', 250_000);
    expect(row.tokenLimit).toBe(250_000);
    expect(getKey(row.id)?.tokenLimit).toBe(250_000);
  });

  it('finds a key by hash and stops finding it after deletion', () => {
    const { raw, row } = newKey('delete-me');
    const hash = hashApiKey(raw);
    expect(findKeyByHash(hash)?.id).toBe(row.id);
    expect(deleteKey(row.id)).toBe(true);
    expect(findKeyByHash(hash)).toBeNull();
    expect(getKey(row.id)).toBeNull();
    expect(deleteKey(row.id)).toBe(false);
  });

  it('authenticates from Authorization, x-api-key and api-key headers', () => {
    const { raw, row } = newKey('headers');
    const url = 'http://127.0.0.1:3210/v1/chat/completions';
    const cases = [
      new Request(url, { headers: { authorization: `Bearer ${raw}` } }),
      new Request(url, { headers: { 'x-api-key': raw } }),
      new Request(url, { headers: { 'api-key': raw } }),
    ];
    for (const request of cases) {
      expect(extractApiKey(request)).toBe(raw);
      const auth = authenticateRequest(request);
      expect(auth.ok).toBe(true);
      if (auth.ok) expect(auth.key.id).toBe(row.id);
    }

    deleteKey(row.id);
    expect(authenticateRequest(cases[0]!)).toEqual({ ok: false, reason: 'invalid' });
    expect(authenticateRequest(new Request(url))).toEqual({ ok: false, reason: 'missing' });
  });

  it('lists keys newest first and keeps them distinct', () => {
    const before = listKeys().length;
    newKey('list-a');
    newKey('list-b');
    const rows = listKeys();
    expect(rows.length).toBe(before + 2);
    expect(rows[0]!.id).toBeGreaterThan(rows[1]!.id);
  });
});