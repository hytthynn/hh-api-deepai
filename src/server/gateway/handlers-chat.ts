import 'server-only';
import type { ChatRequest } from '@/src/core/gateway/types';
import type { UpstreamResult } from '@/src/core/gateway/types';
import { normalizeChat } from '@/src/core/gateway/normalize';
import { parseChatCompletion } from '@/src/core/gateway/parse';
import { renderChatCompletion } from '@/src/core/gateway/render-chat';
import { GatewayError } from '@/src/core/gateway/errors';
import { sseResponse } from './http';
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
import { logger } from '@/src/lib/logger';

const DONE_FRAME = new TextEncoder().encode('data: [DONE]\n\n');

function clientName(request: Request): string {
  return (request.headers.get('user-agent') ?? 'unknown').slice(0, 120);
}

function extractUsage(text: string): { input: number; output: number } | null {
  const start = text.lastIndexOf('"usage"');
  if (start === -1) return null;
  const brace = text.indexOf('{', start);
  if (brace === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = brace; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(text.slice(brace, end)) as Record<string, unknown>;
    const input = Number(parsed.prompt_tokens ?? parsed.input_tokens ?? 0);
    const output = Number(parsed.completion_tokens ?? parsed.output_tokens ?? 0);
    return { input: Number.isFinite(input) ? input : 0, output: Number.isFinite(output) ? output : 0 };
  } catch {
    return null;
  }
}

function chatPassthrough(
  source: ReadableStream<Uint8Array>,
  ctx: GatewayContext,
  meta: {
    model: string;
    accountId: number;
    accountEmail: string;
    attempts: number;
    firstByteMs: number;
  },
  onAbort: () => void,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let tail = '';
  let sawDone = false;
  let closed = false;

  const finish = (error?: unknown): void => {
    if (closed) return;
    closed = true;
    release();
    const usage = extractUsage(tail);
    recordRequest(ctx, {
      model: meta.model,
      stream: true,
      accountId: meta.accountId,
      attempts: meta.attempts,
      httpStatus: error ? 502 : 200,
      latencyMs: Date.now() - ctx.startedAt,
      firstByteMs: meta.firstByteMs,
      inputTokens: usage?.input ?? 0,
      outputTokens: usage?.output ?? 0,
      errorCode: error ? 'stream_error' : null,
      detail: error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : null,
    });
    if (error) {
      logger.warn('gateway', `chat stream broke: ${error instanceof Error ? error.message : String(error)}`, {
        accountId: meta.accountId,
        requestId: ctx.requestId,
      });
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const rest = decoder.decode();
          if (rest) tail = (tail + rest).slice(-65_536);
          if (!sawDone) controller.enqueue(DONE_FRAME);
          finish();
          controller.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        tail = (tail + text).slice(-65_536);
        if (text.includes('[DONE]')) sawDone = true;
        controller.enqueue(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ error: { message, type: 'server_error', code: 'stream_error' } })}\n\n`,
          ),
        );
        finish(error);
        controller.close();
      }
    },
    cancel() {
      onAbort();
      void reader.cancel().catch(() => undefined);
      finish();
    },
  });
}

export async function handleChat(request: Request): Promise<Response> {
  const auth = begin(request, 'chat', 'chat');
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(ctx, new GatewayError('invalid_request', 400, 'Request body is not valid JSON'));
  }

  let body: ChatRequest;
  try {
    body = normalizeChat(raw);
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

  const detail = env.debugBody ? JSON.stringify(raw).slice(0, 2_000) : null;

  try {
    const run = await runUpstream(body, {
      free: model.free,
      requestId: ctx.requestId,
      signal: request.signal,
      stream: body.stream,
      timeoutMs: env.upstreamTimeoutMs,
    });

    if (run.kind === 'stream') {
      const stream = chatPassthrough(
        run.upstream.body,
        ctx,
        {
          model: body.model,
          accountId: run.account.id,
          accountEmail: run.account.email,
          attempts: run.attempts,
          firstByteMs: run.firstByteAt - ctx.startedAt,
        },
        () => run.upstream.controller.abort(),
        run.release,
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
      recordRequest(ctx, {
        model: body.model,
        stream: false,
        accountId: run.account.id,
        attempts: run.attempts,
        httpStatus: 200,
        latencyMs: Date.now() - ctx.startedAt,
        client: clientName(request),
        detail,
      });
      return new Response(run.bodyText, {
        status: 200,
        headers: { ...successMeta(ctx, run.attempts, run.account.email), 'content-type': 'application/json' },
      });
    }

    const rendered = renderChatCompletion(result, body.model);
    recordRequest(ctx, {
      model: body.model,
      stream: false,
      accountId: run.account.id,
      attempts: run.attempts,
      httpStatus: 200,
      latencyMs: Date.now() - ctx.startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      client: clientName(request),
      detail,
    });
    return Response.json(rendered, {
      status: 200,
      headers: successMeta(ctx, run.attempts, run.account.email),
    });
  } catch (error) {
    return fail(ctx, error, { model: body.model, stream: body.stream });
  }
}