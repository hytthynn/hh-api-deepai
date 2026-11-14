import 'server-only';
import { globalState } from '@/src/lib/global-state';
import { logger } from '@/src/lib/logger';

type Lease = { requestId: string; leaseUntil: number };

const MAX_LEASE_MS = 900_000;

function leases(): Map<number, Lease> {
  return globalState('slots', () => new Map<number, Lease>());
}

export const slots = {
  tryAcquire(accountId: number, requestId: string, now = Date.now()): (() => void) | null {
    const existing = leases().get(accountId);
    if (existing && existing.leaseUntil > now) return null;
    if (existing) {
      logger.warn('gateway', `slot lease expired for account ${accountId}`, {
        accountId,
        meta: { previous_request: existing.requestId, request: requestId },
      });
    }
    leases().set(accountId, { requestId, leaseUntil: now + MAX_LEASE_MS });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = leases().get(accountId);
      if (current && current.requestId === requestId) leases().delete(accountId);
    };
  },

  isBusy(accountId: number, now = Date.now()): boolean {
    const lease = leases().get(accountId);
    return lease !== undefined && lease.leaseUntil > now;
  },

  busyIds(now = Date.now()): Set<number> {
    const out = new Set<number>();
    for (const [id, lease] of leases()) if (lease.leaseUntil > now) out.add(id);
    return out;
  },

  size(): number {
    return leases().size;
  },

  async drain(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (leases().size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },

  reset(): void {
    leases().clear();
  },
};