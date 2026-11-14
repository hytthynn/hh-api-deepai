export type FailoverKind =
  | 'ok'
  | 'client_error'
  | 'auth'
  | 'social_login_required'
  | 'machine_required'
  | 'session_busy'
  | 'lane_version'
  | 'rate_limit'
  | 'server_error'
  | 'network'
  | 'insufficient';

export type AccountAction = 'none' | 'cooldown' | 'dead' | 'exhausted' | 'rotate_machine' | 'lane_update';

export type FailureInput = {
  status: number | null;
  bodyText?: string;
  retryAfterSec?: number | null;
  network?: boolean;
  laneVersion?: number;
};

export type FailureClass = {
  kind: FailoverKind;
  /** this account cannot serve the request right now → try another one */
  nextAccount: boolean;
  /** repeat on the same account (machine rotation / lane bump) */
  sameAccount: boolean;
  /** return the upstream error to the client without retrying */
  fatal: boolean;
  cooldownMs: number;
  accountAction: AccountAction;
  status: number;
  code: string;
};

const INSUFFICIENT = /(insufficient|balance|theos|quota)/i;

export function classifyFailure(input: FailureInput): FailureClass {
  const { status, bodyText = '', network = false, retryAfterSec } = input;
  const retryAfterMs =
    typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(60, Math.max(1, retryAfterSec)) * 1000
      : null;

  if (network || status === null) {
    return fail('network', true, false, false, 30_000, 'cooldown', 503, 'upstream_unreachable');
  }

  if (status === 200) {
    return {
      kind: 'ok',
      nextAccount: false,
      sameAccount: false,
      fatal: false,
      cooldownMs: 0,
      accountAction: 'none',
      status: 200,
      code: 'ok',
    };
  }

  const lower = bodyText.toLowerCase();

  if (lower.includes('session_busy') || status === 409) {
    return fail('session_busy', true, false, false, retryAfterMs ?? 3_000, 'cooldown', 409, 'session_busy');
  }
  if (lower.includes('lane_version_unsupported') || status === 426) {
    return fail('lane_version', false, true, false, 5_000, 'lane_update', 426, 'lane_version_unsupported');
  }
  if (lower.includes('machine_required')) {
    return fail('machine_required', false, true, false, 5_000, 'rotate_machine', 403, 'machine_required');
  }
  if (lower.includes('social_login_required')) {
    return fail('social_login_required', false, false, false, 0, 'dead', 403, 'social_login_required');
  }
  if (status === 401 || status === 403) {
    return fail('auth', true, false, false, 600_000, 'cooldown', status, 'upstream_auth');
  }
  if (status === 429) {
    return fail('rate_limit', true, false, false, retryAfterMs ?? 120_000, 'cooldown', 429, 'upstream_rate_limit');
  }
  if (status >= 500) {
    return fail('server_error', true, false, false, 30_000, 'cooldown', status, 'upstream_error');
  }
  if (status === 400 || status === 422) {
    return fail('client_error', false, false, true, 0, 'none', status, 'upstream_bad_request');
  }
  if (INSUFFICIENT.test(lower)) {
    return fail('insufficient', true, false, false, 0, 'exhausted', 402, 'insufficient_balance');
  }
  return fail('client_error', false, false, true, 0, 'none', status, 'upstream_error');
}

function fail(
  kind: FailoverKind,
  nextAccount: boolean,
  sameAccount: boolean,
  fatal: boolean,
  cooldownMs: number,
  accountAction: AccountAction,
  status: number,
  code: string,
): FailureClass {
  return { kind, nextAccount, sameAccount, fatal, cooldownMs, accountAction, status, code };
}

export const MAX_ATTEMPTS = 8;
export const MAX_MACHINE_ROTATIONS = 2;

/** 401/403 → dead after 3 consecutive failures (SPEC §16.2 / domain rule 5). */
export function nextAuthState(account: { failCount: number }): { dead: boolean; failCount: number } {
  const failCount = account.failCount + 1;
  return { dead: failCount >= 3, failCount };
}