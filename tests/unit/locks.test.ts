import { spawn } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { db } from '@/src/adapters/db/client';
import { locks } from '@/src/adapters/db/schema';
import { acquireLock, lockHolder } from '@/src/lib/locks';

const TTL = 90_000;

beforeEach(() => {
  closeDb();
  runMigrations();
});

afterAll(() => {
  closeDb();
});

/** A pid that is definitely alive for the duration of the test. */
function spawnIdle(): { pid: number; stop: () => Promise<void> } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  return {
    pid: child.pid ?? -1,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}

describe('SPEC §23 instance lock', () => {
  it('a second live pid cannot take the lock and the first one can release it', async () => {
    const other = spawnIdle();
    try {
      const held = acquireLock('hh-api', TTL, other.pid);
      expect(held).not.toBeNull();
      expect(lockHolder('hh-api')?.pid).toBe(other.pid);

      expect(acquireLock('hh-api', TTL, process.pid)).toBeNull();

      held?.release();
      expect(lockHolder('hh-api')).toBeNull();
      expect(acquireLock('hh-api', TTL, process.pid)).not.toBeNull();
    } finally {
      await other.stop();
    }
  });

  it('a stale row from a crashed process is taken over', () => {
    db()
      .insert(locks)
      .values({ name: 'hh-api', pid: 424_242, ts: Date.now() - TTL - 1_000 })
      .run();

    const held = acquireLock('hh-api', TTL, process.pid);
    expect(held).not.toBeNull();
    expect(lockHolder('hh-api')?.pid).toBe(process.pid);
    held?.release();
  });

  it('a row owned by a dead pid is taken over before the ttl expires', async () => {
    const other = spawnIdle();
    await other.stop();
    db()
      .insert(locks)
      .values({ name: 'hh-api', pid: other.pid, ts: Date.now() })
      .run();

    const held = acquireLock('hh-api', TTL, process.pid);
    expect(held).not.toBeNull();
    expect(lockHolder('hh-api')?.pid).toBe(process.pid);
    held?.release();
  });

  it('the same process re-acquires its own row (second module graph in Next dev)', () => {
    const first = acquireLock('hh-api', TTL, process.pid);
    expect(first).not.toBeNull();
    const second = acquireLock('hh-api', TTL, process.pid);
    expect(second).not.toBeNull();
    second?.release();
    expect(lockHolder('hh-api')).toBeNull();
  });
});