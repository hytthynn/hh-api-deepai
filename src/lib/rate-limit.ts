import { globalState } from './global-state';

type Bucket = { tokens: number; updatedAt: number };

function buckets(): Map<number, Bucket> {
  return globalState('rate-limit', () => new Map<number, Bucket>());
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/** Token bucket: `rpm` tokens per 60s window, one token per request. */
export function consumeToken(keyId: number, rpm: number, now = Date.now()): RateLimitResult {
  const capacity = Math.max(1, rpm);
  const refillPerMs = capacity / 60_000;
  let bucket = buckets().get(keyId);
  if (!bucket) {
    bucket = { tokens: capacity, updatedAt: now };
    buckets().set(keyId, bucket);
  }
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  const missing = 1 - bucket.tokens;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(missing / refillPerMs / 1000)) };
}

export function resetRateLimits(): void {
  buckets().clear();
}