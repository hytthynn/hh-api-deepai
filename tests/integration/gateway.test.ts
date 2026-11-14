import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/adapters/upstream/headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/adapters/upstream/headers')>();
  return { ...actual, API_BASE: 'http://127.0.0.1:3212' };
});

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createAccount, getAccount, updateAccount } from '@/src/adapters/db/repositories/accounts';
import { createKey, revokeKey } from '@/src/adapters/db/repositories/keys';
import { setModelEnabled } from '@/src/adapters/db/repositories/models';
import { queryRequests } from '@/src/adapters/db/repositories/requests';
import { serializeCookies } from '@/src/adapters/upstream/cookies';
import { encrypt, generateApiKey, hashApiKey } from '@/src/lib/crypto';
import { maskEmail } from '@/src/lib/ids';
import { resetRateLimits } from '@/src/lib/rate-limit';
import { slots } from '@/src/server/slots';
import { SseParser, type SseEvent } from '@/src/core/gateway/sse';
import type { Account, AccountStatus } from '@/src/core/entities/account';
import { startGateway, type Gateway } from '../fixtures/gateway';
import { startUpstream, type UpstreamMock } from '../fixtures/upstream';

const FREE_MODEL = 'glm-5.3-flash';
const PAID_MODEL = 'claude-sonnet-5-5';

let upstreamMock: UpstreamMock;
let gateway: Gateway;

beforeAll(async () => {
  upstreamMock = await startUpstream(3212);
  gateway = await startGateway(3211);
});

afterAll(async () => {
  await gateway.close();
  await upstreamMock.close();
  closeDb();
});

beforeEach(() => {
  closeDb();
  runMigrations();
  upstreamMock.reset();
  slots.reset();
  resetRateLimits();
});

function seedAccount(
  email: string,
  options: { balance?: number; status?: AccountStatus; lastUsedAt?: number } = {},
): Account {
  const balance = options.balance ?? 65;
  const account = createAccount({
    email,
    passwordEnc: null,
    cookiesEnc: encrypt(serializeCookies([{ name: 'sessionid', value: email, domain: 'deepai.org' }])),
    machine: `machine-${email}`,
    status: options.status ?? 'active',
    balance,
    granted: balance,
    laneVersion: 4,
  });
  if (options.lastUsedAt !== undefined) updateAccount(account.id, { lastUsedAt: options.lastUsedAt });
  return account;
}

function seedKey(): string {
  const key = generateApiKey();
  createKey({
    name: 'integration',
    prefix: key.slice(0, 11),
    last4: key.slice(-4),
    keyHash: hashApiKey(key),
    rpmLimit: 10_000,
  });
  return key;
}

function post(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${gateway.url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function sseEvents(response: Response): Promise<SseEvent[]> {
  const parser = new SseParser();
  return [...parser.push(await response.text()), ...parser.flush()];
}

async function waitFor(check: () => boolean, timeoutMs = 1_000, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return check();
}

/** Concatenates `choices[0].delta.content` of a raw chat SSE body. */
function streamedText(raw: string): string {
  const parser = new SseParser();
  const events = [...parser.push(raw), ...parser.flush()];
  let text = '';
  for (const event of events) {
    if (event.data === '[DONE]') continue;
    const payload = JSON.parse(event.data) as { choices?: Array<{ delta?: { content?: string } }> };
    text += payload.choices?.[0]?.delta?.content ?? '';
  }
  return text;
}

describe('SPEC §25.2 integration: chat completions', () => {
  it('1. non-stream request returns 200 with x-hh-attempts: 1', async () => {
    const account = seedAccount('first@example.test', { lastUsedAt: 1_000 });
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-hh-attempts')).toBe('1');
    expect(response.headers.get('x-hh-account')).toBe(maskEmail(account.email));
    const body = (await response.json()) as {
      choices: Array<{ message: { role: string; content: string } }>;
      usage: Record<string, number>;
      object: string;
    };
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0]?.message).toEqual({ role: 'assistant', content: 'mock answer!' });
    expect(body.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });

    const calls = upstreamMock.chatCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.account).toBe(account.email);
    expect(calls[0]?.body.stream).toBe(false);
    expect(calls[0]?.body.model).toBe(FREE_MODEL);
    expect(slots.busyIds().size).toBe(0);
  });

  it('2. first account 429, second ok → 200, attempts=2, first in cooldown', async () => {
    const first = seedAccount('a@example.test', { lastUsedAt: 1_000 });
    const second = seedAccount('b@example.test', { lastUsedAt: 2_000 });
    upstreamMock.plan('a@example.test', ['429']);
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-hh-attempts')).toBe('2');
    expect(response.headers.get('x-hh-account')).toBe(maskEmail(second.email));

    const failed = getAccount(first.id);
    expect(failed?.status).toBe('cooldown');
    expect(failed?.cooldownUntil).toBeGreaterThan(Date.now());

    expect(upstreamMock.chatCalls().map((call) => call.account)).toEqual([
      'a@example.test',
      'b@example.test',
    ]);
    expect(slots.busyIds().size).toBe(0);
  });

  it('3. every account 429 → 503 all_accounts_failed', async () => {
    seedAccount('a@example.test', { lastUsedAt: 1_000 });
    seedAccount('b@example.test', { lastUsedAt: 2_000 });
    upstreamMock.plan('a@example.test', ['429']);
    upstreamMock.plan('b@example.test', ['429']);
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('x-hh-attempts')).toBe('2');
    const body = (await response.json()) as { error: { code: string; type: string } };
    expect(body.error.code).toBe('all_accounts_failed');
    expect(slots.busyIds().size).toBe(0);
  });

  it('4. balance_zero on a paid model → account exhausted, next account serves', async () => {
    const first = seedAccount('a@example.test', { balance: 5, lastUsedAt: 1_000 });
    const second = seedAccount('b@example.test', { balance: 5, lastUsedAt: 2_000 });
    upstreamMock.plan('a@example.test', ['balance_zero']);
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: PAID_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-hh-attempts')).toBe('2');
    expect(response.headers.get('x-hh-account')).toBe(maskEmail(second.email));
    expect(getAccount(first.id)?.status).toBe('exhausted');
    expect(getAccount(second.id)?.status).toBe('active');
  });

  it('5. free model with balance=0 still succeeds on the same account', async () => {
    const account = seedAccount('free@example.test', { balance: 0, lastUsedAt: 1_000 });
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-hh-attempts')).toBe('1');
    expect(response.headers.get('x-hh-account')).toBe(maskEmail(account.email));
    expect(getAccount(account.id)?.status).toBe('active');
    expect(upstreamMock.chatCalls().map((call) => call.account)).toEqual(['free@example.test']);
  });
});

describe('SPEC §25.2 integration: streaming', () => {
  it('6. upstream drops mid-stream → error event and the slot is released', async () => {
    seedAccount('drop@example.test', { lastUsedAt: 1_000 });
    upstreamMock.plan('drop@example.test', ['stream_drop']);
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('partial');
    expect(text).toContain('"code":"stream_error"');
    expect(slots.busyIds().size).toBe(0);
  });

  it('7. /v1/messages stream keeps the Anthropic event order and never sends [DONE]', async () => {
    seedAccount('anthropic@example.test', { lastUsedAt: 1_000 });
    upstreamMock.setDefaultMode('stream');
    const key = seedKey();

    const response = await post('/v1/messages', key, {
      model: FREE_MODEL,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
    });

    expect(response.status).toBe(200);
    const events = await sseEvents(response);
    expect(events.map((event) => event.event)).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(events.some((event) => event.data === '[DONE]')).toBe(false);

    const start = JSON.parse(events[0]!.data) as { message: { usage: { input_tokens: number } } };
    expect(start.message.usage.input_tokens).toBeGreaterThan(0);

    const deltas = events
      .filter((event) => event.event === 'content_block_delta')
      .map((event) => (JSON.parse(event.data) as { delta: { text: string } }).delta.text);
    expect(deltas.join('')).toBe('mock answer!');

    const stop = JSON.parse(events[7]!.data) as {
      delta: { stop_reason: string; stop_sequence: string | null };
      usage: { output_tokens: number };
    };
    expect(stop.delta).toEqual({ stop_reason: 'end_turn', stop_sequence: null });
    expect(stop.usage.output_tokens).toBe(3);
    expect(slots.busyIds().size).toBe(0);
  });

  it('streams persist first_byte_ms (B-021): queue wait shows up as latency − first byte', async () => {
    seedAccount('firstbyte@example.test', { lastUsedAt: 1_000 });
    upstreamMock.setDefaultMode('stream');
    const key = seedKey();

    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
    });
    expect(response.status).toBe(200);
    await response.text();

    const row = queryRequests({ per: 1 }).rows[0];
    expect(row?.stream).toBe(1);
    expect(row?.httpStatus).toBe(200);
    expect(row?.firstByteMs).not.toBeNull();
    expect(row?.firstByteMs ?? -1).toBeGreaterThanOrEqual(0);
    expect(row?.firstByteMs ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(row?.latencyMs ?? 0);
    expect(slots.busyIds().size).toBe(0);
  });

  it('8. /v1/responses stream reports usage and replays history via previous_response_id', async () => {
    seedAccount('responses@example.test', { lastUsedAt: 1_000 });
    upstreamMock.setDefaultMode('stream');
    const key = seedKey();

    const first = await post('/v1/responses', key, {
      model: FREE_MODEL,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      stream: true,
    });
    expect(first.status).toBe(200);
    const events = await sseEvents(first);
    const completed = events.find((event) => event.event === 'response.completed');
    expect(completed).toBeDefined();
    const payload = JSON.parse(completed!.data) as {
      response: {
        id: string;
        output_text: string;
        usage: { input_tokens: number; output_tokens: number; total_tokens: number };
        output: Array<{ type: string }>;
      };
    };
    expect(payload.response.output_text).toBe('mock answer!');
    expect(payload.response.usage).toEqual({ input_tokens: 12, output_tokens: 3, total_tokens: 15 });
    expect(payload.response.output[0]?.type).toBe('message');

    upstreamMock.setDefaultMode('ok');
    const second = await post('/v1/responses', key, {
      model: FREE_MODEL,
      previous_response_id: payload.response.id,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'again' }] }],
      stream: false,
    });
    expect(second.status).toBe(200);
    const stored = upstreamMock.chatCalls();
    expect(stored).toHaveLength(2);
    // SPEC §12: only the stored `response.output` is prepended to `input`; `instructions` are not inherited.
    expect(stored[1]?.body.messages).toEqual([
      { role: 'assistant', content: 'mock answer!' },
      { role: 'user', content: 'again' },
    ]);
  });

  it('9. a client abort stops the upstream call and frees the slot within 1s', async () => {
    seedAccount('abort@example.test', { lastUsedAt: 1_000 });
    upstreamMock.plan('abort@example.test', ['stream_slow']);
    const key = seedKey();
    const controller = new AbortController();

    const response = await post(
      '/v1/chat/completions',
      key,
      { model: FREE_MODEL, messages: [{ role: 'user', content: 'ping' }], stream: true },
      controller.signal,
    );
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);

    expect(await waitFor(() => upstreamMock.chatCalls()[0]?.aborted === true, 1_000)).toBe(true);

    let released = false;
    for (let i = 0; i < 50 && !released; i += 1) {
      released = slots.busyIds().size === 0;
      if (!released) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(released).toBe(true);
    expect(slots.size()).toBe(0);
  });
});

describe('SPEC §25.2 integration: auth, models and concurrency', () => {
  it('10. a revoked key is rejected with 401', async () => {
    seedAccount('revoked@example.test', { lastUsedAt: 1_000 });
    const key = seedKey();
    const response = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(response.status).toBe(200);

    const { listKeys } = await import('@/src/adapters/db/repositories/keys');
    const id = listKeys()[0]!.id;
    expect(revokeKey(id)).toBe(true);

    const denied = await post('/v1/chat/completions', key, {
      model: FREE_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(denied.status).toBe(401);
    const body = (await denied.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_api_key');
  });

  it('11. /v1/models lists only enabled models', async () => {
    const key = seedKey();
    setModelEnabled('solar-mini-4', false);

    const response = await fetch(`${gateway.url}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { object: string; data: Array<{ id: string }> };
    const ids = body.data.map((model) => model.id);
    expect(body.object).toBe('list');
    expect(ids).toContain(FREE_MODEL);
    expect(ids).not.toContain('solar-mini-4');
  });

  it('12. 20 parallel streams across 4 accounts all succeed on the first attempt', async () => {
    const accounts = [1, 2, 3, 4].map((index) =>
      seedAccount(`p${index}@example.test`, { lastUsedAt: index * 1_000 }),
    );
    upstreamMock.setDefaultMode('stream');
    const key = seedKey();

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        post('/v1/chat/completions', key, {
          model: FREE_MODEL,
          messages: [{ role: 'user', content: `ping ${index}` }],
          stream: true,
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
    expect(responses.map((response) => response.headers.get('x-hh-attempts'))).toEqual(Array(20).fill('1'));

    const texts = await Promise.all(responses.map((response) => response.text()));
    for (const text of texts) {
      expect(text).toContain('data: [DONE]');
      expect(streamedText(text)).toBe('mock answer!');
    }

    expect(slots.busyIds().size).toBe(0);
    const used = new Set(upstreamMock.chatCalls().map((call) => call.account));
    expect(used.size).toBeGreaterThan(1);
    for (const account of accounts) {
      expect(getAccount(account.id)?.status).toBe('active');
    }
  });
});