import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/src/adapters/db/client';
import { locks } from '@/src/adapters/db/schema';

export type HeldLock = { name: string; release: () => void };

/**
 * SPEC §23: only one process may run cron and the engine pool. A lock row older than
 * `ttlMs`, owned by this very process (a second module graph in the same Node process)
 * or owned by a dead pid (crash, Ctrl+C) is taken over instead of blocking startup.
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireLock(name: string, ttlMs = 90_000, pid = process.pid): HeldLock | null {
  const now = Date.now();
  const staleBefore = now - ttlMs;
  const existing = lockHolder(name);

  if (existing) {
    const owned = existing.pid === pid;
    const stale = existing.ts < staleBefore;
    const gone = !isPidAlive(existing.pid);
    if (!owned && !stale && !gone) return null;
    db().update(locks).set({ pid, ts: now }).where(sql`${locks.name} = ${name}`).run();
  } else {
    const result = db()
      .insert(locks)
      .values({ name, pid, ts: now })
      .onConflictDoNothing()
      .run();
    if (result.changes !== 1) {
      const holder = lockHolder(name);
      if (holder && holder.pid !== pid && holder.ts >= staleBefore && isPidAlive(holder.pid)) return null;
      db().update(locks).set({ pid, ts: now }).where(sql`${locks.name} = ${name}`).run();
    }
  }

  const heartbeat = setInterval(() => {
    try {
      db()
        .update(locks)
        .set({ ts: Date.now() })
        .where(sql`${locks.name} = ${name} AND ${locks.pid} = ${pid}`)
        .run();
    } catch {
      // DB closed during shutdown
    }
  }, Math.max(5_000, Math.floor(ttlMs / 3)));
  heartbeat.unref?.();

  return {
    name,
    release: () => {
      clearInterval(heartbeat);
      try {
        db()
          .delete(locks)
          .where(sql`${locks.name} = ${name} AND ${locks.pid} = ${pid}`)
          .run();
      } catch {
        // ignore
      }
    },
  };
}

export function lockHolder(name: string): { pid: number; ts: number } | null {
  const row = db().select().from(locks).where(sql`${locks.name} = ${name}`).get();
  return row ? { pid: row.pid, ts: row.ts } : null;
}