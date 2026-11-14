import { describe, expect, it } from 'vitest';
import type { Account } from '@/src/core/entities/account';
import { candidateOrder, chooseAccount, isEligible, sortCandidates } from '@/src/core/accounts/select';
import { expireCooldown, reduceAccount } from '@/src/core/accounts/state';

const NOW = 1_700_000_000_000;

function account(overrides: Partial<Account> & { id: number }): Account {
  return {
    email: `user${overrides.id}@example.test`,
    passwordEnc: null,
    cookiesEnc: 'v1.iv.tag.ct',
    machine: 'machine',
    status: 'active',
    balance: 10,
    granted: 65,
    refreshAt: null,
    laneVersion: 4,
    lastUsedAt: null,
    lastCheckedAt: NOW,
    cooldownUntil: 0,
    failCount: 0,
    successCount: 0,
    source: 'bm',
    bmOrderId: null,
    createdAt: NOW,
    updatedAt: NOW,
    notes: null,
    ...overrides,
  };
}

describe('select: eligibility (SPEC §16.1)', () => {
  it('serves free models from exhausted accounts but not paid ones', () => {
    const broke = account({ id: 1, status: 'exhausted', balance: 0 });
    expect(isEligible(broke, true, NOW)).toBe(true);
    expect(isEligible(broke, false, NOW)).toBe(false);

    const rich = account({ id: 2, status: 'active', balance: 65 });
    expect(isEligible(rich, false, NOW)).toBe(true);
  });

  it('skips disabled, dead, pending, cooling and cookieless accounts', () => {
    const cases: Account[] = [
      account({ id: 1, status: 'disabled' }),
      account({ id: 2, status: 'dead' }),
      account({ id: 3, status: 'pending' }),
      account({ id: 4, status: 'cooldown', cooldownUntil: NOW + 1_000 }),
      account({ id: 5, cookiesEnc: null }),
    ];
    for (const candidate of cases) {
      expect(isEligible(candidate, true, NOW)).toBe(false);
    }
    expect(isEligible(account({ id: 6, status: 'cooldown', cooldownUntil: NOW - 1 }), true, NOW)).toBe(false);
  });
});

describe('select: ordering and round-robin', () => {
  it('puts active accounts before exhausted and uses last_used_at ASC NULLS FIRST', () => {
    const sorted = sortCandidates([
      account({ id: 1, status: 'exhausted', lastUsedAt: 5 }),
      account({ id: 2, status: 'active', lastUsedAt: 10 }),
      account({ id: 3, status: 'active', lastUsedAt: null }),
      account({ id: 4, status: 'active', lastUsedAt: 1 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([3, 4, 2, 1]);
  });

  it('breaks ties by id', () => {
    const sorted = sortCandidates([
      account({ id: 9, lastUsedAt: 3 }),
      account({ id: 8, lastUsedAt: 3 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([8, 9]);
  });

  it('round-robins by last_used_at', () => {
    const pool = [
      account({ id: 1, lastUsedAt: 100 }),
      account({ id: 2, lastUsedAt: 200 }),
      account({ id: 3, lastUsedAt: 50 }),
    ];
    const picks: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const chosen = chooseAccount({ candidates: pool, freeModel: true, now: NOW, busy: new Set() });
      expect(chosen).not.toBeNull();
      picks.push(chosen!.id);
      const index = pool.findIndex((item) => item.id === chosen!.id);
      pool[index] = { ...pool[index]!, lastUsedAt: NOW + i };
    }
    expect(picks).toEqual([3, 1, 2]);
  });

  it('prefers a free slot over a busy account but still returns one when all are busy', () => {
    const pool = [account({ id: 1, lastUsedAt: 1 }), account({ id: 2, lastUsedAt: 2 })];
    expect(chooseAccount({ candidates: pool, freeModel: true, now: NOW, busy: new Set([1]) })?.id).toBe(2);
    expect(chooseAccount({ candidates: pool, freeModel: true, now: NOW, busy: new Set([1, 2]) })?.id).toBe(1);
  });

  it('returns null when nothing is eligible and candidateOrder filters disabled', () => {
    const pool = [account({ id: 1, status: 'disabled' }), account({ id: 2, balance: 0, status: 'active' })];
    expect(chooseAccount({ candidates: pool, freeModel: false, now: NOW, busy: new Set() })).toBeNull();
    expect(candidateOrder(pool, false, NOW)).toEqual([]);
    expect(candidateOrder(pool, true, NOW).map((item) => item.id)).toEqual([2]);
  });
});

describe('state machine (SPEC §16.4)', () => {
  it('applies success, exhausted and cooldown patches', () => {
    const active = account({ id: 1, successCount: 2 });
    expect(reduceAccount(active, { type: 'success', now: 42 }, NOW)).toMatchObject({
      status: 'active',
      lastUsedAt: 42,
      successCount: 3,
      failCount: 0,
    });
    expect(reduceAccount(active, { type: 'exhausted' }, NOW)).toEqual({ status: 'exhausted', balance: 0 });
    expect(reduceAccount(active, { type: 'cooldown', until: 99 }, NOW)).toEqual({ status: 'cooldown', cooldownUntil: 99 });
  });

  it('goes dead on the third auth failure', () => {
    const first = reduceAccount(account({ id: 1, failCount: 0 }), { type: 'auth_fail', now: 100 }, NOW);
    expect(first).toEqual({ status: 'cooldown', failCount: 1, cooldownUntil: 100 + 600_000 });
    const second = reduceAccount(account({ id: 1, failCount: 1 }), { type: 'auth_fail', now: 100 }, NOW);
    expect(second.status).toBe('cooldown');
    const third = reduceAccount(account({ id: 1, failCount: 2 }), { type: 'auth_fail', now: 100 }, NOW);
    expect(third).toEqual({ status: 'dead', failCount: 3 });
  });

  it('restores exhausted accounts when the balance comes back and expires cooldowns', () => {
    expect(
      reduceAccount(account({ id: 1, status: 'exhausted', balance: 0 }), {
        type: 'balance_ok',
        balance: 65,
        granted: 65,
        refreshAt: null,
      }),
    ).toMatchObject({ status: 'active', balance: 65 });
    expect(
      reduceAccount(account({ id: 1 }), { type: 'balance_ok', balance: 0, granted: 0, refreshAt: null }),
    ).toMatchObject({ status: 'exhausted' });

    expect(expireCooldown(account({ id: 1, status: 'cooldown', cooldownUntil: NOW - 1 }), NOW)).toBe('active');
    expect(expireCooldown(account({ id: 1, status: 'cooldown', cooldownUntil: NOW + 60_000 }), NOW)).toBeNull();
    expect(expireCooldown(account({ id: 1, status: 'active' }), NOW)).toBeNull();
  });

  it('probe results and manual toggles reset counters', () => {
    expect(
      reduceAccount(account({ id: 1, failCount: 4 }), {
        type: 'probe_ok',
        balance: 65,
        granted: 65,
        refreshAt: '2026-01-01T00:00:00.000Z',
        laneVersion: 4,
      }),
    ).toMatchObject({ status: 'active', balance: 65, failCount: 0, cooldownUntil: 0 });
    expect(reduceAccount(account({ id: 1 }), { type: 'probe_fail' }, NOW)).toEqual({ status: 'dead', lastCheckedAt: NOW });
    expect(reduceAccount(account({ id: 1 }), { type: 'manual', status: 'disabled' })).toEqual({
      status: 'disabled',
      cooldownUntil: 0,
    });
    expect(reduceAccount(account({ id: 1, failCount: 2 }), { type: 'manual', status: 'active' })).toMatchObject({
      status: 'active',
      failCount: 0,
    });
  });
});