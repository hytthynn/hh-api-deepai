import type { Account, AccountStatus } from '../entities/account';

export type AccountEvent =
  | { type: 'probe_ok'; balance: number; granted: number; refreshAt: string | null; laneVersion: number | null }
  | { type: 'probe_fail' }
  | { type: 'success'; now: number }
  | { type: 'exhausted' }
  | { type: 'cooldown'; until: number }
  | { type: 'auth_fail'; now: number }
  | { type: 'dead' }
  | { type: 'lane_update'; laneVersion: number }
  | { type: 'machine_rotated'; machine: string }
  | { type: 'manual'; status: 'active' | 'disabled' }
  | { type: 'balance_ok'; balance: number; granted: number; refreshAt: string | null };

export type AccountPatch = Partial<
  Pick<
    Account,
    | 'status'
    | 'balance'
    | 'granted'
    | 'refreshAt'
    | 'laneVersion'
    | 'machine'
    | 'lastUsedAt'
    | 'lastCheckedAt'
    | 'cooldownUntil'
    | 'failCount'
    | 'successCount'
  >
>;

const AUTH_DEAD_THRESHOLD = 3;

/** SPEC §16.4 state machine, pure: (account, event) → patch. */
export function reduceAccount(account: Account, event: AccountEvent, now = Date.now()): AccountPatch {
  switch (event.type) {
    case 'probe_ok':
      return {
        status: 'active',
        balance: event.balance,
        granted: event.granted,
        refreshAt: event.refreshAt,
        laneVersion: event.laneVersion,
        lastCheckedAt: now,
        cooldownUntil: 0,
        failCount: 0,
      };
    case 'probe_fail':
      return { status: 'dead', lastCheckedAt: now };
    case 'success':
      return {
        status: 'active',
        lastUsedAt: event.now,
        successCount: account.successCount + 1,
        failCount: 0,
      };
    case 'exhausted':
      return { status: 'exhausted', balance: 0 };
    case 'cooldown':
      return { status: 'cooldown', cooldownUntil: event.until };
    case 'auth_fail': {
      const failCount = account.failCount + 1;
      return failCount >= AUTH_DEAD_THRESHOLD
        ? { status: 'dead', failCount }
        : { status: 'cooldown', failCount, cooldownUntil: event.now + 600_000 };
    }
    case 'dead':
      return { status: 'dead' };
    case 'lane_update':
      return { status: 'active', laneVersion: event.laneVersion };
    case 'machine_rotated':
      return { machine: event.machine };
    case 'manual':
      return event.status === 'disabled'
        ? { status: 'disabled', cooldownUntil: 0 }
        : { status: 'active', cooldownUntil: 0, failCount: 0 };
    case 'balance_ok':
      return {
        status: event.balance > 0 ? 'active' : 'exhausted',
        balance: event.balance,
        granted: event.granted,
        refreshAt: event.refreshAt,
        lastCheckedAt: now,
        cooldownUntil: 0,
      };
    default:
      return {};
  }
}

/** Cooldown expiry: cooldown → active (only if the lease actually ran out). */
export function expireCooldown(account: Account, now: number): AccountStatus | null {
  if (account.status !== 'cooldown') return null;
  if (account.cooldownUntil > now) return null;
  return 'active';
}

export function isDeadStatus(status: AccountStatus): boolean {
  return status === 'dead';
}