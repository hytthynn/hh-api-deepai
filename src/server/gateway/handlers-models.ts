import 'server-only';
import type { Model } from '@/src/core/entities/model';
import { GatewayError } from '@/src/core/gateway/errors';
import { getModel, listModels } from '@/src/adapters/db/repositories/models';
import { begin, exposeDisabled, fail, successMeta } from './pipeline';

function modelObject(model: Model) {
  return {
    id: model.id,
    object: 'model' as const,
    created: Math.floor(model.syncedAt / 1000),
    owned_by: 'deepai',
    context_window: model.contextWindow,
    max_tokens: model.maxTokens,
    hh: {
      free: model.free,
      premier: model.premier,
      modalities: model.modalities,
      enabled: model.enabled,
    },
  };
}

/**
 * SPEC §11: `/v1/models` is a catalogue read and is intentionally not written to
 * `requests` — otherwise client polling would skew the dashboard counters.
 */
export function handleModelsList(request: Request): Response {
  const auth = begin(request, 'models', 'chat');
  if (!auth.ok) return auth.response;
  const models = listModels(exposeDisabled());
  return Response.json(
    { object: 'list', data: models.map(modelObject) },
    { status: 200, headers: successMeta(auth.ctx, 0, null) },
  );
}

export function handleModelGet(request: Request, rawId: string): Response {
  const auth = begin(request, 'models', 'chat');
  if (!auth.ok) return auth.response;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  const model = getModel(id);
  if (!model || (!model.enabled && !exposeDisabled())) {
    return fail(auth.ctx, new GatewayError('model_not_found', 404, `Model "${id}" was not found`));
  }
  return Response.json(modelObject(model), { status: 200, headers: successMeta(auth.ctx, 0, null) });
}