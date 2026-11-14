import { api, jsonBody } from '@/src/server/api';
import { lastSyncAt, listModels } from '@/src/adapters/db/repositories/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async () =>
  jsonBody({
    models: listModels(true).map((model) => ({
      id: model.id,
      display_name: model.displayName,
      free: model.free,
      premier: model.premier,
      context_window: model.contextWindow,
      max_tokens: model.maxTokens,
      modalities: model.modalities,
      enabled: model.enabled,
      synced_at: model.syncedAt,
    })),
    last_sync_at: lastSyncAt(),
  }),
);