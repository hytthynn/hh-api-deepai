import { BASE_MODELS, DEFAULT_SETTINGS } from '@/src/core/catalog';
import { passwordHash } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import { db } from './client';
import { models } from './schema';
import { getSetting, setSetting } from './repositories/settings';

export function seedDatabase(): void {
  const now = Date.now();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (getSetting(key) !== null) continue;
    setSetting(key, value);
  }

  for (const model of BASE_MODELS) {
    db()
      .insert(models)
      .values({
        id: model.id,
        displayName: model.displayName,
        free: model.free ? 1 : 0,
        premier: model.premier ? 1 : 0,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        modalities: model.modalities,
        enabled: 1,
        syncedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  const adminPassword = process.env.HH_ADMIN_PASSWORD?.trim();
  if (adminPassword && !getSetting('admin.password_hash')) {
    setSetting('admin.password_hash', passwordHash(adminPassword));
    logger.info('system', 'admin password hash initialised from HH_ADMIN_PASSWORD');
  }
  // The legacy BM key is imported by `src/server/runtime.ts` (ADR-011) so that it is
  // written exactly once, already encrypted, and never re-encrypted on later boots.
}