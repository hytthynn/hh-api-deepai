import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { handleChat } from '@/src/server/gateway/handlers-chat';
import { handleResponseCancel, handleResponseDelete, handleResponseGet, handleResponses } from '@/src/server/gateway/handlers-responses';
import {
  handleAnthropicCountTokens,
  handleAnthropicMessages,
} from '@/src/server/gateway/handlers-anthropic';
import { handleModelGet, handleModelsList } from '@/src/server/gateway/handlers-models';

export type Gateway = { url: string; close: () => Promise<void> };

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function headerBag(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function pump(response: Response, res: ServerResponse): void {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let cancelled = false;
  res.on('close', () => {
    if (res.writableEnded) return;
    cancelled = true;
    void reader.cancel('client disconnected').catch(() => undefined);
  });

  void (async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) await once(res, 'drain');
      }
      if (!cancelled) res.end();
    } catch {
      res.destroy();
    }
  })();
}

async function dispatch(req: IncomingMessage, port: number, signal: AbortSignal): Promise<Response> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  const request = new Request(url, {
    method,
    headers: headerBag(req),
    body: body ? new Uint8Array(body) : undefined,
    signal,
  });

  if (method === 'POST' && path === '/v1/chat/completions') return handleChat(request);
  if (method === 'POST' && path === '/v1/responses') return handleResponses(request);
  if (method === 'POST' && path === '/v1/messages') return handleAnthropicMessages(request);
  if (method === 'POST' && path === '/v1/messages/count_tokens') return handleAnthropicCountTokens(request);

  const cancelMatch = /^\/v1\/responses\/([^/]+)\/cancel$/.exec(path);
  if (method === 'POST' && cancelMatch?.[1]) return handleResponseCancel(request, decodeURIComponent(cancelMatch[1]));

  const responseMatch = /^\/v1\/responses\/([^/]+)$/.exec(path);
  if (responseMatch?.[1]) {
    const id = decodeURIComponent(responseMatch[1]);
    if (method === 'GET') return handleResponseGet(request, id);
    if (method === 'DELETE') return handleResponseDelete(request, id);
  }

  if (method === 'GET' && path === '/v1/models') return handleModelsList(request);
  const modelMatch = /^\/v1\/models\/([^/]+)$/.exec(path);
  if (method === 'GET' && modelMatch?.[1]) return handleModelGet(request, decodeURIComponent(modelMatch[1]));

  return Response.json({ error: { code: 'not_found', message: `No route for ${method} ${path}` } }, { status: 404 });
}

export function startGateway(port = 3211): Promise<Gateway> {
  const server: Server = createServer((req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    dispatch(req, port, controller.signal)
      .then((response) => pump(response, res))
      .catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'internal_error', message } }));
      });
  });

  return new Promise<Gateway>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}