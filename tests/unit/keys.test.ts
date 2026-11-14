import { beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createKey, findActiveKeyByHash, getKey, listKeys, revokeKey } from '@/src/adapters/db/repositories/keys';
import { API_KEY_PATTERN, generateApiKey, hashApiKey } from '@/src/lib/crypto';
import { authenticateRequest, extractApiKey } from '@/src/server/gateway/auth';

function newKey(name = 'test', rpmLimit = 60) {
  const raw = generateApiKey();
  const row = createKey({
    name,
    prefix: raw.slice(0, 11),
    last4: raw.slice(-4),
    keyHash: hashApiKey(raw),
    rpmLimit,
  });
  return { raw, row };
}

describe('keys: storage and revocation', () => {
  beforeAll(() => {
    closeDb();
    runMigrations();
  });

  it('stores only the hash, prefix and last4', () => {
    const { raw, row } = newKey('storage');
    expect(raw).toMatch(API_KEY_PATTERN);
    expect(row.keyHash).toBe(hashApiKey(raw));
    expect(row.keyHash).not.toContain(raw);
    expect(row.prefix).toBe(raw.slice(0, 11));
    expect(row.last4).toBe(raw.slice(-4));
    expect(row.revokedAt).toBeNull();
    const stored = JSON.stringify(getKey(row.id));
    expect(stored).not.toContain(raw);
  });

  it('finds an active key by hash and stops finding it after revocation', () => {
    const { raw, row } = newKey('revoke-me');
    const hash = hashApiKey(raw);
    expect(findActiveKeyByHash(hash)?.id).toBe(row.id);
    expect(revokeKey(row.id)).toBe(true);
    expect(findActiveKeyByHash(hash)).toBeNull();
    expect(getKey(row.id)?.revokedAt).toBeTypeOf('number');
    expect(revokeKey(row.id)).toBe(false);
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

    revokeKey(row.id);
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