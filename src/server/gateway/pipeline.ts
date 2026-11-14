import 'server-only';
import type { ApiKey } from '@/src/core/entities/api-key';
import type { Model } from '@/src/core/entities/model';
import type { Endpoint, RequestRecord } from '@/src/core/entities/request-log';
import { GatewayError, UpstreamClientError, isGatewayError } from '@/src/core/gateway/errors';
import { nearestModels } from '@/src/core/gateway/models';
import { hasImageContent, type ChatRequest } from '@/src/core/gateway/types';
import type { RequestFilter } from '@/src/adapters/db/repositories/requests';
import { insertRequest, queryRequests } from '@/src/adapters/db/repositories/requests';
import { getModel, listModels } from '@/src/adapters/db/repositories/models';
import { getBool, getSetting } from '@/src/adapters/db/repositories/settings';
import { consumeToken } from '@/src/lib/rate-limit';
import { logger } from '@/src/lib/logger';
import { requestId } from '@/src/lib/ids';
import { errorResponse, metaHeaders, type ErrorProtocol } from './http';
import { authenticateRequest } from './auth';

export type GatewayContext = {
  requestId: string;
  key: ApiKey;
  startedAt: number;
  endpoint: Endpoint;
  protocol: ErrorProtocol;
};

export type AuthOutcome = { ok: true; ctx: GatewayContext } | { ok: false; response: Response };

export function begin(request: Request, endpoint: Endpoint, protocol: ErrorProtocol): AuthOutcome {
  const id = requestId();
  const auth = authenticateRequest(request);
  if (!auth.ok) {
    const error =
      auth.reason === 'missing'
        ? new GatewayError('missing_api_key', 401, 'Missing API key')
        : new GatewayError('invalid_api_key', 401, 'Invalid API key');
    return { ok: false, response: errorResponse(error, protocol, { requestId: id, attempts: 0 }) };
  }
  const limit = consumeToken(auth.key.id, auth.key.rpmLimit);
  if (!limit.ok) {
    const error = new GatewayError('rate_limit_exceeded', 429, `Rate limit exceeded (${auth.key.rpmLimit} rpm)`, {
      retryAfterSec: limit.retryAfterSec,
    });
    return { ok: false, response: errorResponse(error, protocol, { requestId: id, attempts: 0 }) };
  }
  return {
    ok: true,
    ctx: { requestId: id, key: auth.key, startedAt: Date.now(), endpoint, protocol },
  };
}

export function defaultModel(): string {
  return getSetting('gateway.default_model') ?? 'glm-5.3-flash';
}

export function resolveModel(id: string | null | undefined): Model {
  const wanted = id?.trim() || defaultModel();
  const model = getModel(wanted);
  if (model && model.enabled) return model;
  const nearest = nearestModels(wanted, listModels(true));
  const hint = nearest.length > 0 ? ` Did you mean: ${nearest.join(', ')}?` : '';
  throw new GatewayError('model_not_found', 404, `Model "${wanted}" is not available.${hint}`);
}

export function assertContentSupport(model: Model, request: ChatRequest): void {
  if (!hasImageContent(request.messages)) return;
  if (model.modalities.includes('image')) return;
  const candidates = listModels(false)
    .filter((entry) => entry.modalities.includes('image'))
    .slice(0, 5)
    .map((entry) => entry.id);
  throw new GatewayError(
    'unsupported_content',
    400,
    `Model "${model.id}" does not accept images. Use one of: ${candidates.join(', ')}`,
  );
}

export type RecordPatch = Partial<Omit<RequestRecord, 'ts' | 'requestId' | 'apiKeyId' | 'endpoint'>>;

export function recordRequest(ctx: GatewayContext, patch: RecordPatch): void {
  const record: RequestRecord = {
    ts: ctx.startedAt,
    requestId: ctx.requestId,
    apiKeyId: ctx.key.id,
    endpoint: ctx.endpoint,
    model: patch.model ?? null,
    stream: patch.stream ?? false,
    accountId: patch.accountId ?? null,
    attempts: patch.attempts ?? 0,
    httpStatus: patch.httpStatus ?? null,
    latencyMs: patch.latencyMs ?? null,
    firstByteMs: patch.firstByteMs ?? null,
    inputTokens: patch.inputTokens ?? 0,
    outputTokens: patch.outputTokens ?? 0,
    theosBefore: patch.theosBefore ?? null,
    theosAfter: patch.theosAfter ?? null,
    errorCode: patch.errorCode ?? null,
    client: patch.client ?? null,
    detail: patch.detail ?? null,
  };
  try {
    insertRequest(record);
  } catch (error) {
    logger.error('gateway', `cannot persist request ${ctx.requestId}`, {
      requestId: ctx.requestId,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

export function successMeta(
  ctx: GatewayContext,
  attempts: number,
  accountEmail: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  return metaHeaders({ requestId: ctx.requestId, attempts, accountEmail, extraHeaders: extra });
}

export function fail(
  ctx: GatewayContext,
  error: unknown,
  options: { model?: string | null; stream?: boolean; attempts?: number } = {},
): Response {
  if (error instanceof UpstreamClientError) {
    recordRequest(ctx, {
      model: options.model ?? null,
      stream: options.stream ?? false,
      httpStatus: error.status,
      attempts: options.attempts ?? 1,
      latencyMs: Date.now() - ctx.startedAt,
      errorCode: 'upstream_bad_request',
      detail: error.bodyText.slice(0, 500),
    });
    return new Response(error.bodyText, {
      status: error.status,
      headers: { ...successMeta(ctx, options.attempts ?? 1, null), 'content-type': 'application/json' },
    });
  }
  const gatewayError = isGatewayError(error)
    ? error
    : new GatewayError('internal_error', 500, error instanceof Error ? error.message : String(error));
  const attempts = gatewayError.attempts ?? options.attempts ?? 0;
  recordRequest(ctx, {
    model: options.model ?? null,
    stream: options.stream ?? false,
    httpStatus: gatewayError.status,
    attempts,
    latencyMs: Date.now() - ctx.startedAt,
    errorCode: gatewayError.code,
    detail: gatewayError.message.slice(0, 500),
  });
  const level = gatewayError.status >= 500 || gatewayError.status === 0 ? 'error' : 'warn';
  logger[level]('gateway', `${gatewayError.code}: ${gatewayError.message}`, {
    requestId: ctx.requestId,
    meta: { status: gatewayError.status, attempts },
  });
  return errorResponse(gatewayError, ctx.protocol, { requestId: ctx.requestId, attempts });
}

export function listRequestsForUi(filter: RequestFilter) {
  return queryRequests(filter);
}

export function exposeDisabled(): boolean {
  return getBool('gateway.expose_disabled', false);
}