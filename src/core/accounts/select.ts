import type { Account } from '../entities/account';

export type SlotState = { leaseUntil: number; requestId: string };

export type ChooseInput = {
  candidates: Account[];
  freeModel: boolean;
  now: number;
  busy: ReadonlySet<number>;
};

/**
 * SPEC §16.1: active first, then least recently used (NULLS FIRST).
 * `exhausted` accounts still serve free models, paid models require balance > 0.
 */
export function sortCandidates(candidates: Account[]): Account[] {
  return [...candidates].sort((a, b) => {
    const statusDelta = Number(b.status === 'active') - Number(a.status === 'active');
    if (statusDelta !== 0) return statusDelta;
    const aUsed = a.lastUsedAt ?? 0;
    const bUsed = b.lastUsedAt ?? 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.id - b.id;
  });
}

export function isEligible(account: Account, freeModel: boolean, now: number): boolean {
  if (account.status !== 'active' && account.status !== 'exhausted') return false;
  if (account.cookiesEnc === null) return false;
  if (account.cooldownUntil > now) return false;
  if (!freeModel && account.balance <= 0) return false;
  return true;
}

export function chooseAccount(input: ChooseInput): Account | null {
  const eligible = input.candidates.filter((account) => isEligible(account, input.freeModel, input.now));
  const idle = eligible.filter((account) => !input.busy.has(account.id));
  const pool = idle.length > 0 ? idle : eligible;
  const [first] = sortCandidates(pool);
  return first ?? null;
}

/** Account order for one request: never repeat the same account twice. */
export function candidateOrder(candidates: Account[], freeModel: boolean, now: number): Account[] {
  return sortCandidates(candidates.filter((account) => isEligible(account, freeModel, now)));
}