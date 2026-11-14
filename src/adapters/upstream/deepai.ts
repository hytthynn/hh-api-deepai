import 'server-only';
import { parseChatCompletion } from '@/src/core/gateway/parse';
import type { ChatRequest, UpstreamResult } from '@/src/core/gateway/types';
import type { UpstreamCredentials, UpstreamPort, UpstreamResponse, UpstreamStream } from '@/src/core/ports/upstream';
import type { UpstreamModel } from '@/src/core/entities/model';
import { env } from '@/src/lib/config';
import { cookieHeader, jsonHeaders, laneHeaders, sessionHeaders, CHAT_PATH, MODELS_PATH, THEOS_PATH, API_BASE } from './headers';

const DEFAULT_TIMEOUT_MS = 300_000;
const THEOS_TIMEOUT_MS = 30_000;
const MODELS_TIMEOUT_MS = 30_000;

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs));
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

function requestHeaders(credentials: UpstreamCredentials, extra: Record<string, string>): Record<string, string> {
  return {
    ...sessionHeaders(),
    ...laneHeaders({ machine: credentials.machine, laneVersion: credentials.laneVersion }),
    ...(credentials.cookies.length > 0 ? { Cookie: cookieHeader(credentials.cookies) } : {}),
    ...extra,
  };
}

function serializeMessage(message: ChatRequest['messages'][number]): Record<string, unknown> {
  const out: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  if (message.tool_calls) out.tool_calls = message.tool_calls;
  if (message.name) out.name = message.name;
  return out;
}

export function upstreamBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(serializeMessage),
    stream: request.stream,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stop && request.stop.length > 0) body.stop = request.stop;
  if (request.tools && request.tools.length > 0) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.responseFormat !== undefined) body.response_format = request.responseFormat;
  if (request.parallelToolCalls !== undefined) body.parallel_tool_calls = request.parallelToolCalls;
  return body;
}

async function readJson(response: Response): Promise<{ status: number; body: unknown }> {
  const text = await response.text();
  if (!text) return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text.slice(0, 2_000) };
  }
}

export const upstream: UpstreamPort = {
  async theos(credentials, call) {
    const response = await fetch(`${API_BASE}${THEOS_PATH}`, {
      method: 'GET',
      headers: requestHeaders(credentials, jsonHeaders()),
      signal: withTimeout(call.signal, call.timeoutMs ?? THEOS_TIMEOUT_MS),
    });
    return readJson(response);
  },

  async models(credentials, call) {
    const response = await fetch(`${API_BASE}${MODELS_PATH}`, {
      method: 'GET',
      headers: requestHeaders(credentials, jsonHeaders()),
      signal: withTimeout(call.signal, call.timeoutMs ?? MODELS_TIMEOUT_MS),
    });
    const payload = await readJson(response);
    if (payload.status !== 200) return payload;
    return { status: payload.status, body: payload.body };
  },

  async chatJson(credentials, request, call): Promise<UpstreamResponse> {
    const response = await fetch(`${API_BASE}${CHAT_PATH}`, {
      method: 'POST',
      headers: requestHeaders(credentials, jsonHeaders()),
      body: JSON.stringify({ ...upstreamBody(request), stream: false }),
      signal: withTimeout(call.signal, call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return { status: response.status, headers: response.headers, bodyText: await response.text() };
  },

  async chatStream(credentials, request, call): Promise<UpstreamStream> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    call.signal.addEventListener('abort', onAbort, { once: true });
    const response = await fetch(`${API_BASE}${CHAT_PATH}`, {
      method: 'POST',
      headers: requestHeaders(credentials, {
        ...jsonHeaders(),
        Accept: 'text/event-stream',
      }),
      body: JSON.stringify({ ...upstreamBody(request), stream: true }),
      signal: withTimeout(controller.signal, call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.body) {
      call.signal.removeEventListener('abort', onAbort);
      return { status: response.status, headers: response.headers, body: new ReadableStream<Uint8Array>({ start: (c) => c.close() }), controller };
    }
    return { status: response.status, headers: response.headers, body: response.body, controller };
  },

  async complete(credentials, request, call): Promise<UpstreamResult> {
    const result = await upstream.chatJson(credentials, request, call);
    if (result.status !== 200) throw new Error(`upstream ${result.status}`);
    const parsed: unknown = JSON.parse(result.bodyText);
    return parseChatCompletion(parsed, request.model);
  },
};

export function parseModelsPayload(body: unknown): UpstreamModel[] {
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const list = Array.isArray(data.models) ? data.models : [];
  const out: UpstreamModel[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) continue;
    const input = Array.isArray(item.input)
      ? item.input.filter((value): value is string => typeof value === 'string')
      : ['text'];
    out.push({
      id,
      premier: item.premier === true,
      contextWindow: typeof item.contextWindow === 'number' ? item.contextWindow : Number(item.contextWindow) || null,
      maxTokens: typeof item.maxTokens === 'number' ? item.maxTokens : Number(item.maxTokens) || null,
      input: input.length > 0 ? input : ['text'],
    });
  }
  return out;
}

export const upstreamTimeoutMs = env.upstreamTimeoutMs;