import 'server-only';
import { desc, eq } from 'drizzle-orm';
import type { ApiKey } from '@/src/core/entities/api-key';
import { db } from '../client';
import { apiKeys } from '../schema';

function toKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return { ...row };
}

export function listKeys(): ApiKey[] {
  return db().select().from(apiKeys).orderBy(desc(apiKeys.id)).all().map(toKey);
}

export function getKey(id: number): ApiKey | null {
  const row = db().select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  return row ? toKey(row) : null;
}

export function createKey(input: {
  name: string;
  prefix: string;
  last4: string;
  keyHash: string;
  keyEnc?: string | null;
  tokenLimit?: number | null;
}): ApiKey {
  const row = db()
    .insert(apiKeys)
    .values({ ...input, createdAt: Date.now() })
    .returning()
    .get();
  return toKey(row);
}

export function findKeyByHash(hash: string): ApiKey | null {
  const row = db().select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).get();
  return row ? toKey(row) : null;
}

/** SPEC §11: keys are deleted, not revoked — rows disappear together with their history link. */
export function deleteKey(id: number): boolean {
  const result = db().delete(apiKeys).where(eq(apiKeys.id, id)).run();
  return result.changes === 1;
}

export function touchKey(id: number, now = Date.now()): void {
  db().update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, id)).run();
}