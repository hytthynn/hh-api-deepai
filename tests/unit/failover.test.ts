import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  MAX_ATTEMPTS,
  MAX_MACHINE_ROTATIONS,
  nextAuthState,
} from '@/src/core/gateway/failover';

describe('failover: SPEC §16.2 table', () => {
  it('200 → success, no state change', () => {
    const failure = classifyFailure({ status: 200 });
    expect(failure).toMatchObject({ kind: 'ok', accountAction: 'none', nextAccount: false, fatal: false, cooldownMs: 0 });
  });

  it('400 → fatal, returned to the client without retry', () => {
    const failure = classifyFailure({ status: 400, bodyText: '{"error":"bad schema"}' });
    expect(failure).toMatchObject({
      kind: 'client_error',
      fatal: true,
      nextAccount: false,
      sameAccount: false,
      accountAction: 'none',
      status: 400,
      code: 'upstream_bad_request',
    });
  });

  it('422 → fatal as well', () => {
    const failure = classifyFailure({ status: 422, bodyText: 'unprocessable' });
    expect(failure).toMatchObject({ kind: 'client_error', fatal: true, status: 422 });
  });

  it('401/403 → cooldown 10 min, next account, dead after 3 failures', () => {
    for (const status of [401, 403]) {
      const failure = classifyFailure({ status, bodyText: 'unauthorized' });
      expect(failure).toMatchObject({
        kind: 'auth',
        nextAccount: true,
        fatal: false,
        cooldownMs: 600_000,
        accountAction: 'cooldown',
        status,
      });
    }

    expect(nextAuthState({ failCount: 0 })).toEqual({ dead: false, failCount: 1 });
    expect(nextAuthState({ failCount: 1 })).toEqual({ dead: false, failCount: 2 });
    expect(nextAuthState({ failCount: 2 })).toEqual({ dead: true, failCount: 3 });
    expect(nextAuthState({ failCount: 10 })).toEqual({ dead: true, failCount: 11 });
  });

  it('403 check_in_refused → transient cooldown, never an auth failure (B-026)', () => {
    const failure = classifyFailure({
      status: 403,
      bodyText:
        '{"error":{"message":"DeepAI models are temporarily unavailable. Try again later.","type":"check_in_refused","code":"check_in_refused"}}',
    });
    expect(failure).toMatchObject({
      kind: 'rate_limit',
      nextAccount: true,
      sameAccount: false,
      fatal: false,
      cooldownMs: 120_000,
      accountAction: 'cooldown',
      status: 403,
      code: 'upstream_check_in_refused',
    });
  });

  it('social_login_required → dead, no retry', () => {
    const failure = classifyFailure({ status: 403, bodyText: '{"error":"social_login_required"}' });
    expect(failure).toMatchObject({
      kind: 'social_login_required',
      accountAction: 'dead',
      nextAccount: false,
      sameAccount: false,
      fatal: false,
      cooldownMs: 0,
    });
  });

  it('machine_required → rotate machine and retry on the same account, max 2 rotations', () => {
    const failure = classifyFailure({ status: 403, bodyText: '{"detail":"machine_required"}' });
    expect(failure).toMatchObject({
      kind: 'machine_required',
      sameAccount: true,
      nextAccount: false,
      accountAction: 'rotate_machine',
      cooldownMs: 5_000,
      status: 403,
    });

    expect(MAX_MACHINE_ROTATIONS).toBe(2);
    let rotations = 0;
    let retried = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (rotations < MAX_MACHINE_ROTATIONS) {
        rotations += 1;
        retried += 1;
      }
    }
    expect(retried).toBe(2);
    expect(rotations).toBe(MAX_MACHINE_ROTATIONS);
  });

  it('409 / session_busy → next account, 3 s cooldown by default', () => {
    expect(classifyFailure({ status: 409 })).toMatchObject({
      kind: 'session_busy',
      nextAccount: true,
      cooldownMs: 3_000,
      accountAction: 'cooldown',
    });
    expect(classifyFailure({ status: 400, bodyText: 'session_busy' }).kind).toBe('session_busy');
    expect(classifyFailure({ status: 409, retryAfterSec: 7 }).cooldownMs).toBe(7_000);
    expect(classifyFailure({ status: 409, retryAfterSec: 900 }).cooldownMs).toBe(60_000);
  });

  it('426 / lane_version_unsupported → bump lane and retry once', () => {
    const failure = classifyFailure({ status: 426, bodyText: 'lane_version_unsupported' });
    expect(failure).toMatchObject({
      kind: 'lane_version',
      sameAccount: true,
      nextAccount: false,
      accountAction: 'lane_update',
      cooldownMs: 5_000,
    });
  });

  it('429 → next account, Retry-After or 120 s', () => {
    expect(classifyFailure({ status: 429 })).toMatchObject({
      kind: 'rate_limit',
      nextAccount: true,
      cooldownMs: 120_000,
      status: 429,
    });
    expect(classifyFailure({ status: 429, retryAfterSec: 42 }).cooldownMs).toBe(42_000);
    expect(classifyFailure({ status: 429, retryAfterSec: 0 }).cooldownMs).toBe(120_000);
    expect(classifyFailure({ status: 429, retryAfterSec: 600 }).cooldownMs).toBe(60_000);
  });

  it('5xx and network failures → next account, 30 s cooldown', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyFailure({ status, bodyText: 'boom' })).toMatchObject({
        kind: 'server_error',
        nextAccount: true,
        cooldownMs: 30_000,
        status,
      });
    }
    expect(classifyFailure({ status: null, network: true })).toMatchObject({
      kind: 'network',
      nextAccount: true,
      cooldownMs: 30_000,
      status: 503,
      code: 'upstream_unreachable',
    });
    expect(classifyFailure({ status: null })).toMatchObject({ kind: 'network', nextAccount: true });
  });

  it('insufficient / balance / theos / quota → exhausted, next account', () => {
    for (const bodyText of ['insufficient_balance', 'not enough BALANCE', 'no theos left', 'quota exceeded']) {
      expect(classifyFailure({ status: 402, bodyText })).toMatchObject({
        kind: 'insufficient',
        accountAction: 'exhausted',
        nextAccount: true,
        cooldownMs: 0,
        status: 402,
        code: 'insufficient_balance',
      });
    }
  });

  it('keeps the 8-attempt budget per request', () => {
    expect(MAX_ATTEMPTS).toBe(8);
  });
});