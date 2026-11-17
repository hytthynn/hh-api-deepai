import 'server-only';
import type { UpstreamResult } from '@/src/core/gateway/types';
import { GatewayError } from '@/src/core/gateway/errors';
import { normalizeAnthropic, countInputTokens } from '@/src/core/gateway/normalize';
import { parseChatCompletion } from '@/src/core/gateway/parse';
import { anthropicStreamFrames, renderAnthropicMessage } from '@/src/core/gateway/render-anthropic';
import { streamFromGenerator } from '@/src/core/gateway/sse';
import { sseResponse, streamErrorFrame } from './http';
import {
  assertContentSupport,
  begin,
  defaultModel,
  fail,
  recordRequest,
  resolveModel,
  successMeta,
} from './pipeline';
import { runUpstream } from './run';
import { getInt } from '@/src/adapters/db/repositories/settings';
import { env } from '@/src/lib/config';
import { logger } from '@/src/lib/logger';
import { getModel } from '@/src/adapters/db/repositories/models';

function countTokensModel(raw: unknown): string {
  const wanted = typeof (raw as { model?: unknown }).model === 'string' ? String((raw as { model: string }).model) : '';
  if (wanted && getModel(wanted)) return wanted;
  return defaultModel();
}

export async function handleAnthropicMessages(request: Request): Promise<Response> {
  const auth = begin(request, 'messages', 'messages');
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(ctx, new GatewayError('invalid_request', 400, 'Request body is not valid JSON'));
  }

  let body;
  let thinking = false;
  try {
    const normalized = normalizeAnthropic(raw);
    body = normalized.request;
    thinking = normalized.thinking;
  } catch (error) {
    return fail(ctx, error);
  }
  if (thinking) logger.debug('gateway', 'thinking block ignored', { requestId: ctx.requestId });

  let model;
  try {
    model = resolveModel(body.model);
    assertContentSupport(model, body);
  } catch (error) {
    return fail(ctx, error, { model: body.model, stream: body.stream });
  }

  const estimate = countInputTokens(raw, body.model).tokens;
  const detail = env.debugBody ? JSON.stringify(raw).slice(0, 2_000) : null;

  try {
    const run = await runUpstream(body, {
      free: model.free,
      requestId: ctx.requestId,
      signal: request.signal,
      stream: body.stream,
      timeoutMs: getInt('gateway.upstream_timeout_ms', env.upstreamTimeoutMs),
    });

    if (run.kind === 'stream') {
      let recorded = false;
      const recordStream = (error?: unknown, usage?: { inputTokens: number; outputTokens: number }): void => {
        if (recorded) return;
        recorded = true;
        const clientClosed = request.signal.aborted;
        const failed = error !== undefined && !clientClosed;
        recordRequest(ctx, {
          model: body.model,
          stream: true,
          accountId: run.account.id,
          attempts: run.attempts,
          httpStatus: failed ? 502 : 200,
          latencyMs: Date.now() - ctx.startedAt,
          firstByteMs: run.firstByteAt - ctx.startedAt,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          errorCode: failed ? 'stream_error' : null,
          detail: clientClosed
            ? 'client disconnected mid-stream'
            : failed
              ? (error instanceof Error ? error.message : String(error)).slice(0, 500)
              : detail,
        });
        if (failed) {
          logger.warn('gateway', `messages stream broke: ${error instanceof Error ? error.message : String(error)}`, {
            accountId: run.account.id,
            requestId: ctx.requestId,
          });
        }
      };
      const stream = streamFromGenerator(
        anthropicStreamFrames(
          run.upstream.body,
          { model: body.model, inputTokensEstimate: estimate, stopSequences: body.stop },
          (result) => {
            recordStream(undefined, result.usage);
          },
        ),
        {
          onError: (error) => {
            recordStream(error);
            return request.signal.aborted ? null : streamErrorFrame('messages', error);
          },
          onClose: () => {
            run.release();
            recordStream();
          },
        },
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

    const rendered = renderAnthropicMessage(result, { model: body.model, stopSequences: body.stop });
    recordRequest(ctx, {
      model: body.model,
      stream: false,
      accountId: run.account.id,
      attempts: run.attempts,
      httpStatus: 200,
      latencyMs: Date.now() - ctx.startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      detail,
    });
    return Response.json(rendered, {
      status: 200,
      headers: {
        ...successMeta(ctx, run.attempts, run.account.email),
        'anthropic-version': request.headers.get('anthropic-version') ?? '2023-06-01',
      },
    });
  } catch (error) {
    return fail(ctx, error, { model: body.model, stream: body.stream });
  }
}

export async function handleAnthropicCountTokens(request: Request): Promise<Response> {
  const auth = begin(request, 'count_tokens', 'messages');
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(ctx, new GatewayError('invalid_request', 400, 'Request body is not valid JSON'));
  }
  if (!raw || typeof raw !== 'object') {
    return fail(ctx, new GatewayError('invalid_request', 400, 'Body must be a JSON object'));
  }

  const model = countTokensModel(raw);
  const { tokens } = countInputTokens(raw, model);
  recordRequest(ctx, {
    model,
    stream: false,
    attempts: 0,
    httpStatus: 200,
    latencyMs: Date.now() - ctx.startedAt,
    inputTokens: tokens,
  });
  return Response.json(
    { input_tokens: tokens },
    {
      status: 200,
      headers: {
        ...successMeta(ctx, 0, null),
        'x-hh-approx': '1',
        'anthropic-version': request.headers.get('anthropic-version') ?? '2023-06-01',
      },
    },
  );
}