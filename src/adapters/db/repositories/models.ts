import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { Model } from '@/src/core/entities/model';
import { db } from '../client';
import { models } from '../schema';

function toModel(row: typeof models.$inferSelect): Model {
  return {
    id: row.id,
    displayName: row.displayName,
    free: row.free === 1,
    premier: row.premier === 1,
    contextWindow: row.contextWindow,
    maxTokens: row.maxTokens,
    modalities: row.modalities
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    enabled: row.enabled === 1,
    syncedAt: row.syncedAt,
  };
}

export function listModels(includeDisabled = true): Model[] {
  const query = db().select().from(models);
  const rows = includeDisabled ? query.all() : query.where(eq(models.enabled, 1)).all();
  return rows
    .map(toModel)
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
}

export function getModel(id: string): Model | null {
  const row = db().select().from(models).where(eq(models.id, id)).get();
  return row ? toModel(row) : null;
}

export function upsertModels(list: Array<Omit<Model, 'enabled' | 'syncedAt'>>, syncedAt = Date.now()): void {
  db().transaction((trx) => {
    for (const model of list) {
      trx
        .insert(models)
        .values({
          id: model.id,
          displayName: model.displayName,
          free: model.free ? 1 : 0,
          premier: model.premier ? 1 : 0,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          modalities: model.modalities.join(','),
          syncedAt,
        })
        .onConflictDoUpdate({
          target: models.id,
          set: {
            displayName: model.displayName,
            free: model.free ? 1 : 0,
            premier: model.premier ? 1 : 0,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            modalities: model.modalities.join(','),
            syncedAt,
          },
        })
        .run();
    }
  });
}

export function setModelEnabled(id: string, enabled: boolean): boolean {
  const result = db()
    .update(models)
    .set({ enabled: enabled ? 1 : 0 })
    .where(eq(models.id, id))
    .run();
  return result.changes === 1;
}

export function modelCount(): number {
  const row = db().select({ count: sql<number>`count(*)` }).from(models).get();
  return row?.count ?? 0;
}

export function lastSyncAt(): number | null {
  const row = db().select({ ts: sql<number>`MAX(${models.syncedAt})` }).from(models).get();
  return row?.ts ?? null;
}