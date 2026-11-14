import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/** SPEC §25.2 mock upstream modes. */
export type UpstreamMode =
  | 'ok'
  | 'stream'
  | 'stream_drop'
  | 'stream_slow'
  | 'slow'
  | 'drop'
  | '429'
  | '409'
  | 'machine_required'
  | 'balance_zero'
  | 'unauthorized'
  | 'bad_request'
  | 'lane_update';

export type RecordedCall = {
  method: string;
  path: string;
  account: string;
  mode: UpstreamMode;
  body: Record<string, unknown>;
  cookie: string;
  machine: string | null;
  aborted: boolean;
};

export type UpstreamMock = {
  url: string;
  calls: RecordedCall[];
  chatCalls(account?: string): RecordedCall[];
  setDefaultMode(mode: UpstreamMode): void;
  plan(account: string, modes: UpstreamMode[]): void;
  modesFor(account: string): number;
  reset(): void;
  close(): Promise<void>;
};

const CREATED = 1_700_000_000;

const ERROR_RESPONSES: Partial<Record<UpstreamMode, { status: number; body: unknown }>> = {
  '429': { status: 429, body: { error: 'rate_limit_exceeded' } },
  '409': { status: 409, body: { error: 'session_busy' } },
  machine_required: { status: 403, body: { detail: 'machine_required' } },
  balance_zero: { status: 402, body: { error: 'insufficient_balance' } },
  unauthorized: { status: 401, body: { error: 'unauthorized' } },
  bad_request: { status: 400, body: { error: { message: 'upstream rejected the schema' } } },
  lane_update: { status: 426, body: { detail: 'lane_version_unsupported' } },
};

function accountFromCookie(cookie: string): string {
  const match = /(?:^|;\s*)sessionid=([^;]+)/.exec(cookie);
  return match?.[1]?.trim() ?? 'anonymous';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function completion(model: string): Record<string, unknown> {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: CREATED,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'mock answer!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };
}

function chunk(
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: Record<string, number>,
): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: CREATED,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })}\n\n`;
}

const STREAM_TEXTS = ['mock ', 'answer', '!'];

function streamModel(body: Record<string, unknown>): string {
  return typeof body.model === 'string' ? body.model : 'glm-5.3-flash';
}

async function writeAll(res: ServerResponse, chunks: string[]): Promise<boolean> {
  for (const text of chunks) {
    if (res.destroyed || res.writableEnded) return false;
    try {
      res.write(text);
    } catch {
      return false;
    }
    await delay(5);
  }
  return true;
}

async function respond(
  req: IncomingMessage,
  res: ServerResponse,
  mode: UpstreamMode,
  body: Record<string, unknown>,
  call: RecordedCall,
): Promise<void> {
  if (req.method === 'GET') {
    if (call.path.endsWith('/models')) {
      json(res, 200, {
        models: [
          { id: 'glm-5.3-flash', premier: false, contextWindow: 128_000, maxTokens: 8192, input: ['text', 'image'] },
          { id: 'claude-sonnet-5-5', premier: true, contextWindow: 200_000, maxTokens: 8192, input: ['text', 'image'] },
        ],
      });
      return;
    }
    if (call.path.endsWith('/theos')) {
      json(res, 200, { balance: 65, granted: 65, refresh_at: null, lane_version: 4 });
      return;
    }
    json(res, 404, { error: 'not_found' });
    return;
  }

  const model = streamModel(body);

  if (mode === 'drop') {
    res.destroy();
    return;
  }

  if (mode === 'slow') {
    await delay(2_000);
    if (res.destroyed) return;
    json(res, 200, completion(model));
    return;
  }

  const error = ERROR_RESPONSES[mode];
  if (error) {
    json(res, error.status, error.body);
    return;
  }

  if (mode === 'stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    const frames = [
      chunk(model, { role: 'assistant', content: '' }, null),
      ...STREAM_TEXTS.map((text) => chunk(model, { content: text }, null)),
    ];
    if (!(await writeAll(res, frames))) return;
    res.write(chunk(model, {}, 'stop', { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }));
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (mode === 'stream_drop') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    await writeAll(res, [chunk(model, { role: 'assistant', content: '' }, null), chunk(model, { content: 'partial' }, null)]);
    await delay(20);
    res.destroy();
    return;
  }

  if (mode === 'stream_slow') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    res.write(chunk(model, { role: 'assistant', content: '' }, null));
    for (let index = 0; index < 200; index += 1) {
      if (res.destroyed || res.writableEnded || call.aborted) return;
      try {
        res.write(chunk(model, { content: `.${index}` }, null));
      } catch {
        return;
      }
      await delay(50);
    }
    res.write(chunk(model, {}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  json(res, 200, completion(model));
}

export function startUpstream(port = 3212): Promise<UpstreamMock> {
  const calls: RecordedCall[] = [];
  const plans = new Map<string, UpstreamMode[]>();
  let defaultMode: UpstreamMode = 'ok';

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        body = {};
      }

      const cookie = req.headers.cookie ?? '';
      const account = accountFromCookie(cookie);
      const queue = plans.get(account);
      const mode = queue && queue.length > 0 ? queue.shift()! : defaultMode;
      const call: RecordedCall = {
        method: req.method ?? 'GET',
        path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
        account,
        mode,
        body,
        cookie,
        machine: (req.headers['x-deepai-code-machine'] as string | undefined) ?? null,
        aborted: false,
      };
      calls.push(call);

      res.on('close', () => {
        if (!res.writableEnded) call.aborted = true;
      });

      respond(req, res, mode, body, call).catch(() => {
        try {
          res.destroy();
        } catch {
          // already gone
        }
      });
    });
  });

  const api: UpstreamMock = {
    url: `http://127.0.0.1:${port}`,
    calls,
    chatCalls(account) {
      return calls.filter(
        (call) => call.path.endsWith('/chat/completions') && (account === undefined || call.account === account),
      );
    },
    setDefaultMode(mode) {
      defaultMode = mode;
    },
    plan(account, modes) {
      plans.set(account, [...modes]);
    },
    modesFor(account) {
      return plans.get(account)?.length ?? 0;
    },
    reset() {
      calls.length = 0;
      plans.clear();
      defaultMode = 'ok';
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };

  return new Promise<UpstreamMock>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(api));
  });
}