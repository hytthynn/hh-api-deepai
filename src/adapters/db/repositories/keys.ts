import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
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
  rpmLimit: number;
}): ApiKey {
  const row = db()
    .insert(apiKeys)
    .values({ ...input, createdAt: Date.now() })
    .returning()
    .get();
  return toKey(row);
}

export function findActiveKeyByHash(hash: string): ApiKey | null {
  const row = db()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .get();
  return row ? toKey(row) : null;
}

export function revokeKey(id: number): boolean {
  const result = db()
    .update(apiKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .run();
  return result.changes === 1;
}

export function touchKey(id: number, now = Date.now()): void {
  db().update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, id)).run();
}