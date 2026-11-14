import { GatewayError, isGatewayError } from '@/src/core/gateway/errors';
import { maskEmail } from '@/src/lib/ids';

export type ErrorProtocol = 'chat' | 'responses' | 'messages';

export type ResponseMeta = {
  requestId: string;
  attempts?: number;
  accountEmail?: string | null;
  extraHeaders?: Record<string, string>;
};

export function metaHeaders(meta: ResponseMeta): Record<string, string> {
  const headers: Record<string, string> = {
    'x-request-id': meta.requestId,
    'cache-control': 'no-store',
  };
  if (meta.attempts !== undefined) headers['x-hh-attempts'] = String(meta.attempts);
  if (meta.accountEmail) headers['x-hh-account'] = maskEmail(meta.accountEmail);
  return { ...headers, ...(meta.extraHeaders ?? {}) };
}

function openAiType(error: GatewayError): string {
  if (error.status === 401) return 'invalid_request_error';
  if (error.status === 429) return 'rate_limit_error';
  if (error.status >= 500) return 'server_error';
  return 'invalid_request_error';
}

function anthropicType(error: GatewayError): string {
  if (error.status === 401) return 'authentication_error';
  if (error.status === 403) return 'permission_error';
  if (error.status === 404) return 'not_found_error';
  if (error.status === 429) return 'rate_limit_error';
  if (error.status >= 500) return 'api_error';
  return 'invalid_request_error';
}

export function toGatewayError(error: unknown): GatewayError {
  if (isGatewayError(error)) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new GatewayError('upstream_timeout', 504, 'Upstream request was aborted');
  }
  const message = error instanceof Error ? error.message : String(error);
  return new GatewayError('internal_error', 500, message);
}

export function errorResponse(error: unknown, protocol: ErrorProtocol, meta: ResponseMeta): Response {
  const gatewayError = toGatewayError(error);
  const headers = metaHeaders({ ...meta, attempts: meta.attempts });
  if (gatewayError.retryAfterSec) headers['retry-after'] = String(gatewayError.retryAfterSec);
  if (protocol === 'messages') {
    return Response.json(
      {
        type: 'error',
        error: { type: anthropicType(gatewayError), message: gatewayError.message },
      },
      { status: gatewayError.status, headers },
    );
  }
  return Response.json(
    {
      error: {
        message: gatewayError.message,
        type: openAiType(gatewayError),
        code: gatewayError.code,
      },
    },
    { status: gatewayError.status, headers },
  );
}

export function streamErrorFrame(protocol: ErrorProtocol, error: unknown): string {
  const gatewayError = toGatewayError(error);
  if (protocol === 'messages') {
    return `event: error\ndata: ${JSON.stringify({
      type: 'error',
      error: { type: anthropicType(gatewayError), message: gatewayError.message },
    })}\n\n`;
  }
  if (protocol === 'responses') {
    return `event: error\ndata: ${JSON.stringify({
      type: 'error',
      code: gatewayError.code,
      message: gatewayError.message,
    })}\n\n`;
  }
  return `data: ${JSON.stringify({
    error: { message: gatewayError.message, type: openAiType(gatewayError), code: gatewayError.code },
  })}\n\n`;
}

export function jsonResponse(body: unknown, meta: ResponseMeta, status = 200): Response {
  return Response.json(body, { status, headers: metaHeaders(meta) });
}

export function sseResponse(stream: ReadableStream<Uint8Array>, meta: ResponseMeta): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      ...metaHeaders(meta),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}