import 'server-only';
import type { ApiKey } from '@/src/core/entities/api-key';
import { hashApiKey } from '@/src/lib/crypto';
import { findActiveKeyByHash, touchKey } from '@/src/adapters/db/repositories/keys';

export type KeyAuth =
  | { ok: true; key: ApiKey }
  | { ok: false; reason: 'missing' | 'invalid' };

/** SPEC §11: Bearer first, then x-api-key, then api-key. */
export function extractApiKey(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }
  const xApiKey = request.headers.get('x-api-key');
  if (xApiKey) return xApiKey.trim();
  const apiKey = request.headers.get('api-key');
  if (apiKey) return apiKey.trim();
  return null;
}

export function authenticateRequest(request: Request): KeyAuth {
  const raw = extractApiKey(request);
  if (!raw) return { ok: false, reason: 'missing' };
  const key = findActiveKeyByHash(hashApiKey(raw));
  if (!key) return { ok: false, reason: 'invalid' };
  touchKey(key.id);
  return { ok: true, key };
}