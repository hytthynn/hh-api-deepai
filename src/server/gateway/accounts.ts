import 'server-only';
import type { Account } from '@/src/core/entities/account';
import type { FailureClass } from '@/src/core/gateway/failover';
import { reduceAccount } from '@/src/core/accounts/state';
import { decrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import { getAccount, updateAccount } from '@/src/adapters/db/repositories/accounts';
import { deserializeCookies } from '@/src/adapters/upstream/cookies';
import { deriveMachine, rotateMachine } from '@/src/adapters/upstream/headers';
import type { UpstreamCredentials } from '@/src/core/ports/upstream';

export function credentialsOf(account: Account): UpstreamCredentials {
  let cookies: UpstreamCredentials['cookies'] = [];
  if (account.cookiesEnc) {
    try {
      cookies = deserializeCookies(decrypt(account.cookiesEnc));
    } catch {
      cookies = [];
    }
  }
  const machine = account.machine ?? deriveMachine(account.email);
  return { cookies, machine, laneVersion: account.laneVersion };
}

export function ensureMachine(account: Account): string {
  if (account.machine) return account.machine;
  const machine = deriveMachine(account.email);
  updateAccount(account.id, { machine });
  return machine;
}

export function rotateAccountMachine(account: Account): string {
  const machine = rotateMachine(account.email);
  updateAccount(account.id, { machine });
  return machine;
}

export function setLaneVersion(account: Account, laneVersion: number): void {
  updateAccount(account.id, { laneVersion });
}

/** Applies a classified upstream failure to the account row (SPEC §16.2). */
export function applyFailure(account: Account, failure: FailureClass, now = Date.now()): Account {
  switch (failure.accountAction) {
    case 'cooldown': {
      const patch = reduceAccount(account, { type: 'cooldown', until: now + Math.max(failure.cooldownMs, 1_000) }, now);
      updateAccount(account.id, patch);
      break;
    }
    case 'dead': {
      updateAccount(account.id, reduceAccount(account, { type: 'dead' }, now));
      break;
    }
    case 'exhausted': {
      updateAccount(account.id, reduceAccount(account, { type: 'exhausted' }, now));
      break;
    }
    case 'rotate_machine': {
      rotateAccountMachine(account);
      updateAccount(account.id, { cooldownUntil: now + Math.max(failure.cooldownMs, 1_000) });
      break;
    }
    case 'lane_update': {
      const laneVersion = Math.max(4, account.laneVersion ?? 0);
      setLaneVersion(account, laneVersion);
      updateAccount(account.id, { cooldownUntil: now + Math.max(failure.cooldownMs, 1_000) });
      break;
    }
    case 'none':
      break;
    default:
      break;
  }
  if (failure.kind === 'auth') {
    updateAccount(account.id, reduceAccount(account, { type: 'auth_fail', now }, now));
  }
  const updated = getAccount(account.id);
  if (updated) {
    logger.warn('gateway', `account ${account.email} → ${updated.status} (${failure.code})`, {
      accountId: account.id,
      meta: { code: failure.code, cooldown_ms: failure.cooldownMs },
    });
  }
  return updated ?? account;
}

export function markSuccess(account: Account, now = Date.now()): void {
  updateAccount(account.id, reduceAccount(account, { type: 'success', now }, now));
}

export function loadAccount(id: number): Account | null {
  return getAccount(id);
}