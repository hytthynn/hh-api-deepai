import 'server-only';
import type { ChatRequest } from '@/src/core/gateway/types';
import type { UpstreamResult } from '@/src/core/gateway/types';
import { GatewayError } from '@/src/core/gateway/errors';
import { normalizeResponses } from '@/src/core/gateway/normalize';
import { parseChatCompletion } from '@/src/core/gateway/parse';
import { renderResponseObject, responsesStreamFrames } from '@/src/core/gateway/render-responses';
import { streamFromGenerator } from '@/src/core/gateway/sse';
import { sseResponse, streamErrorFrame } from './http';
import {
  assertContentSupport,
  begin,
  fail,
  recordRequest,
  resolveModel,
  successMeta,
  type GatewayContext,
} from './pipeline';
import { runUpstream } from './run';
import { env } from '@/src/lib/config';
import { deleteResponse, getResponse, putResponse } from '@/src/adapters/db/repositories/responses';
import { getInt } from '@/src/adapters/db/repositories/settings';

function storeResponse(
  ctx: GatewayContext,
  body: { id: string; createdAt: number },
  request: unknown,
  response: unknown,
): void {
  const ttlDays = Math.max(1, getInt('responses.ttl_days', 7));
  putResponse({
    id: body.id,
    apiKeyId: ctx.key.id,
    createdAt: body.createdAt,
    expiresAt: Date.now() + ttlDays * 86_400_000,
    request: JSON.stringify(request).slice(0, 200_000),
    response: JSON.stringify(response).slice(0, 500_000),
  });
}

function previousOutput(prepId: unknown): unknown[] {
  if (typeof prepId !== 'string' || prepId.length === 0) return [];
  const stored = getResponse(prepId);
  if (!stored) {
    throw new GatewayError('previous_response_not_found', 404, `Previous response "${prepId}" was not found or expired`);
  }
  try {
    const parsed = JSON.parse(stored.response) as { output?: unknown };
    return Array.isArray(parsed.output) ? parsed.output : [];
  } catch {
    return [];
  }
}

export async function handleResponses(request: Request): Promise<Response> {
  const auth = begin(request, 'responses', 'responses');
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(ctx, new GatewayError('invalid_request', 400, 'Request body is not valid JSON'));
  }

  let body: ChatRequest;
  let store = true;
  let previousResponseId: string | null = null;
  let prepend: unknown[] = [];
  try {
    const rawPrev = (raw as { previous_response_id?: unknown }).previous_response_id;
    prepend = previousOutput(rawPrev);
    const normalized = normalizeResponses(raw, prepend);
    body = normalized.request;
    store = normalized.store;
    previousResponseId = normalized.previousResponseId;
  } catch (error) {
    return fail(ctx, error);
  }

  let model;
  try {
    model = resolveModel(body.model);
    assertContentSupport(model, body);
  } catch (error) {
    return fail(ctx, error, { model: body.model, stream: body.stream });
  }

  try {
    const run = await runUpstream(body, {
      free: model.free,
      requestId: ctx.requestId,
      signal: request.signal,
      stream: body.stream,
      timeoutMs: env.upstreamTimeoutMs,
    });

    if (run.kind === 'stream') {
      const stream = streamFromGenerator(
        responsesStreamFrames(
          run.upstream.body,
          { model: body.model, previousResponseId, store },
          (result) => {
            if (store) storeResponse(ctx, { id: result.response.id, createdAt: result.response.created_at }, raw, result.response);
            recordRequest(ctx, {
              model: body.model,
              stream: true,
              accountId: run.account.id,
              attempts: run.attempts,
              httpStatus: 200,
              latencyMs: Date.now() - ctx.startedAt,
              firstByteMs: run.firstByteAt - ctx.startedAt,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            });
          },
        ),
        { onError: (error) => streamErrorFrame('responses', error), onClose: run.release },
      );
      return sseResponse(stream, {
        requestId: ctx.requestId,
        attempts: run.attempts,
        accountEmail: run.account.email,
      });
    }

    let result: UpstreamResult;
    try {
      result = parseChatCompletion(JSON.parse(run.bodyText), body.model);
    } catch {
      return fail(ctx, new GatewayError('internal_error', 502, 'Upstream returned an unreadable body'), {
        model: body.model,
      });
    }

    const rendered = renderResponseObject(result, {
      model: body.model,
      previousResponseId,
      store,
    });
    if (store) storeResponse(ctx, { id: rendered.id, createdAt: rendered.created_at }, raw, rendered);
    recordRequest(ctx, {
      model: body.model,
      stream: false,
      accountId: run.account.id,
      attempts: run.attempts,
      httpStatus: 200,
      latencyMs: Date.now() - ctx.startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return Response.json(rendered, { status: 200, headers: successMeta(ctx, run.attempts, run.account.email) });
  } catch (error) {
    return fail(ctx, error, { model: body.model, stream: body.stream });
  }
}

export function handleResponseGet(request: Request, id: string): Response {
  const auth = begin(request, 'responses', 'responses');
  if (!auth.ok) return auth.response;
  const stored = getResponse(id);
  if (!stored) {
    return fail(auth.ctx, new GatewayError('not_found', 404, `Response "${id}" was not found or expired`));
  }
  return new Response(stored.response, {
    status: 200,
    headers: { ...successMeta(auth.ctx, 0, null), 'content-type': 'application/json' },
  });
}

export function handleResponseDelete(request: Request, id: string): Response {
  const auth = begin(request, 'responses', 'responses');
  if (!auth.ok) return auth.response;
  const deleted = deleteResponse(id);
  if (!deleted) {
    return fail(auth.ctx, new GatewayError('not_found', 404, `Response "${id}" was not found`));
  }
  return Response.json(
    { id, object: 'response.deleted', deleted: true },
    { status: 200, headers: successMeta(auth.ctx, 0, null) },
  );
}

export function handleResponseCancel(request: Request, id: string): Response {
  const auth = begin(request, 'responses', 'responses');
  if (!auth.ok) return auth.response;
  const stored = getResponse(id);
  if (!stored) {
    return fail(auth.ctx, new GatewayError('not_found', 404, `Response "${id}" was not found`));
  }
  return Response.json(
    { id, object: 'response', status: 'cancelled' },
    { status: 200, headers: successMeta(auth.ctx, 0, null) },
  );
}