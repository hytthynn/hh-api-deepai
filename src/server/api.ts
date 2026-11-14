import 'server-only';
import { z } from 'zod';
import { BmError } from '@/src/adapters/bm/client';
import { GatewayError } from '@/src/core/gateway/errors';
import { logger } from '@/src/lib/logger';
import { isAuthenticated, sameOrigin } from './auth';
import { ensureBooted } from './runtime';

/** Error envelope from SPEC §10: `{"error":{"code":"...","message":"..."}}`. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function jsonBody(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function apiError(status: number, code: string, message: string): Response {
  return jsonBody({ error: { code, message } }, status);
}

export function toResponse(error: unknown): Response {
  if (error instanceof ApiError) return apiError(error.status, error.code, error.message);
  if (error instanceof GatewayError) return apiError(error.status, error.code, error.message);
  if (error instanceof BmError) return apiError(error.status ?? 400, error.code, error.message);
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    const path = first?.path.join('.');
    return apiError(400, 'bad_request', path ? `${path}: ${first?.message}` : (first?.message ?? 'Invalid request'));
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error('ui', `unhandled admin API error: ${message}`);
  return apiError(500, 'internal_error', message);
}

export type RouteParams<P> = { params: Promise<P> };

type Handler<P> = (request: Request, params: P) => Promise<Response> | Response;

export type RouteOptions = {
  /** Mutations get the CSRF origin check from SPEC §10. */
  mutation?: boolean;
  /** Login must work before a session exists. */
  public?: boolean;
};

/**
 * Wraps an admin route handler: bootstraps the runtime, checks the session cookie,
 * enforces same-origin mutations and normalises every failure into the API envelope.
 */
export function api<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
  options: RouteOptions = {},
) {
  return async (request: Request, context?: RouteParams<P>): Promise<Response> => {
    const state = ensureBooted();
    if (state.error) return apiError(500, 'startup_failed', state.error);
    if (state.locked) {
      return apiError(503, 'db_locked', `Другой экземпляр hh-api держит блокировку БД (pid ${state.lockPid ?? '?'})`);
    }
    if (!options.public && !isAuthenticated(request)) {
      return apiError(401, 'unauthorized', 'Требуется вход в панель');
    }
    if (options.mutation && !sameOrigin(request)) {
      return apiError(403, 'csrf_failed', 'Запрос с чужого origin отклонён');
    }
    try {
      const params = context ? await context.params : ({} as P);
      return await handler(request, params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError('bad_request', 400, 'Тело запроса не является корректным JSON');
  }
  return schema.parse(raw);
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('bad_request', 400, `Некорректный id: ${raw}`);
  return id;
}

export function intParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

export function strParam(params: URLSearchParams, name: string): string | undefined {
  const raw = params.get(name);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}