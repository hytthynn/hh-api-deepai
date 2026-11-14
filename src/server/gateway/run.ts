import 'server-only';
import type { Account } from '@/src/core/entities/account';
import { GatewayError, UpstreamClientError } from '@/src/core/gateway/errors';
import { classifyFailure, MAX_ATTEMPTS, MAX_MACHINE_ROTATIONS, type FailureClass } from '@/src/core/gateway/failover';
import type { ChatRequest } from '@/src/core/gateway/types';
import type { UpstreamStream } from '@/src/core/ports/upstream';
import { env } from '@/src/lib/config';
import { logger } from '@/src/lib/logger';
import { pickCandidates, getAccount } from '@/src/adapters/db/repositories/accounts';
import { upstream } from '@/src/adapters/upstream/deepai';
import { slots } from '../slots';
import { applyFailure, credentialsOf, markSuccess } from './accounts';

export type RunOptions = {
  free: boolean;
  requestId: string;
  signal: AbortSignal;
  stream: boolean;
  exclude?: ReadonlySet<number>;
  timeoutMs?: number;
};

export type RunSuccess =
  | { kind: 'json'; account: Account; attempts: number; status: number; bodyText: string }
  | {
      kind: 'stream';
      account: Account;
      attempts: number;
      upstream: UpstreamStream;
      firstByteAt: number;
      /** Frees the account slot; must be called when the response body is finished. */
      release: () => void;
    };

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

function parseUpstreamJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') {
      const data = parsed as Record<string, unknown>;
      const error = data.error;
      if (typeof error === 'string') return error;
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') return message;
      }
      if (typeof data.detail === 'string') return data.detail;
      if (typeof data.message === 'string') return data.message;
    }
  } catch {
    // plain text
  }
  return bodyText.slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function drainBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 8_000) break;
    }
  } catch {
    // upstream closed mid-body; the status is what matters here
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return text;
}

type Picked = { account: Account; release: () => void };

export async function runUpstream(request: ChatRequest, options: RunOptions): Promise<RunSuccess> {
  const excluded = new Set<number>(options.exclude ?? []);
  const deadline = Date.now() + env.slotWaitMs;
  let attempts = 0;
  let rotations = 0;
  let laneRetries = 0;
  let lastCode: string | null = null;
  let lastMessage = 'no upstream attempt was made';
  let current: Account | null = null;
  let currentRelease: (() => void) | null = null;

  const releaseCurrent = (): void => {
    currentRelease?.();
    currentRelease = null;
    current = null;
  };

  const pick = async (): Promise<Picked | null> => {
    for (;;) {
      const candidates = pickCandidates(options.free).filter(
        (account) => !excluded.has(account.id) && !slots.isBusy(account.id),
      );
      const [account] = candidates;
      if (account) {
        const release = slots.tryAcquire(account.id, options.requestId);
        if (release) return { account, release };
      }
      if (Date.now() >= deadline) return null;
      await sleep(100);
    }
  };

  while (attempts < MAX_ATTEMPTS) {
    if (options.signal.aborted) throw new DOMException('client aborted', 'AbortError');

    if (!current) {
      const picked = await pick();
      if (!picked) {
        if (attempts === 0) {
          throw new GatewayError(
            'no_account_available',
            429,
            'No account is available for this model right now',
            { retryAfterSec: 30 },
          );
        }
        break;
      }
      current = picked.account;
      currentRelease = picked.release;
    }

    attempts += 1;
    const account = current;
    const credentials = credentialsOf(account);

    const onFailure = (failure: FailureClass, message: string): boolean => {
      lastCode = failure.code;
      lastMessage = message;
      if (failure.fatal) {
        releaseCurrent();
        throw new UpstreamClientError(failure.status, message);
      }
      applyFailure(account, failure);
      logger.warn(
        'gateway',
        `failover ${account.email} (${failure.code})${failure.nextAccount ? ' → next account' : ''}`,
        { accountId: account.id, requestId: options.requestId, meta: { code: failure.code, status: failure.status } },
      );
      if (failure.kind === 'machine_required' && rotations < MAX_MACHINE_ROTATIONS) {
        rotations += 1;
        const refreshed = getAccount(account.id);
        current = refreshed ?? account;
        return true;
      }
      if (failure.kind === 'lane_version' && laneRetries < 1) {
        laneRetries += 1;
        const refreshed = getAccount(account.id);
        current = refreshed ?? account;
        return true;
      }
      excluded.add(account.id);
      releaseCurrent();
      return false;
    };

    try {
      if (options.stream) {
        const stream = await upstream.chatStream(credentials, request, {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        });
        if (stream.status === 200) {
          markSuccess(account);
          return {
            kind: 'stream',
            account,
            attempts,
            upstream: stream,
            firstByteAt: Date.now(),
            // The slot stays busy while the client consumes the stream (SPEC §16.1);
            // the handler releases it once the body closes or is cancelled.
            release: () => releaseCurrent(),
          };
        }
        const text = await drainBody(stream.body);
        stream.controller.abort();
        const failure = classifyFailure({
          status: stream.status,
          bodyText: text,
          retryAfterSec: retryAfterSeconds(stream.headers),
        });
        if (onFailure(failure, errorText(text))) continue;
        continue;
      }

      const response = await upstream.chatJson(credentials, request, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      if (response.status === 200) {
        markSuccess(account);
        releaseCurrent();
        return { kind: 'json', account, attempts, status: 200, bodyText: response.bodyText };
      }
      const failure = classifyFailure({
        status: response.status,
        bodyText: response.bodyText,
        retryAfterSec: retryAfterSeconds(response.headers),
      });
      if (onFailure(failure, errorText(response.bodyText))) continue;
      continue;
    } catch (error) {
      if (options.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        releaseCurrent();
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = classifyFailure({ status: null, bodyText: message, network: true });
      if (onFailure(failure, message)) continue;
    }
  }

  releaseCurrent();
  const code = lastCode ?? 'all_accounts_failed';
  throw new GatewayError(
    attempts === 0 ? 'no_account_available' : 'all_accounts_failed',
    attempts === 0 ? 429 : 503,
    `All accounts failed after ${attempts} attempt(s): ${code} (${lastMessage.slice(0, 200)})`,
    { retryAfterSec: attempts === 0 ? 30 : undefined, attempts },
  );
}

export function parseUpstreamPayload(bodyText: string): unknown {
  return parseUpstreamJson(bodyText);
}