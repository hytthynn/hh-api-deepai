import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-026: snapshots are file-based, so this suite needs a real file DB, not :memory:.
// Must run before config is imported (config parses env at import time).
await vi.hoisted(async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.HH_DB_PATH = join(tmpdir(), `hh-db-snapshot-${process.pid}-${Date.now()}.db`);
});

import Database from 'better-sqlite3';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createAccount, getAccountByEmailCI } from '@/src/adapters/db/repositories/accounts';
import { createJob, getJob, updateJob } from '@/src/adapters/db/repositories/jobs';
import { createKey, findKeyByHash } from '@/src/adapters/db/repositories/keys';
import { getSetting, setSetting } from '@/src/adapters/db/repositories/settings';
import { env } from '@/src/lib/config';
import { decrypt, encrypt, generateApiKey, hashApiKey } from '@/src/lib/crypto';
import { resetRuns, beginRun, endRun } from '@/src/jobs/runner';
import { SESSION_COOKIE, signSession } from '@/src/server/auth';
import { slots } from '@/src/server/slots';
import { GET as exportDb } from '@/app/api/db/export/route';
import { POST as importDb } from '@/app/api/db/import/route';

const BASE = 'http://127.0.0.1:3210';

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: {
      cookie: `${SESSION_COOKIE}=${signSession()}`,
      origin: BASE,
      ...(init.headers ?? {}),
    },
  });
}

function binaryRequest(bytes: Buffer | Uint8Array, withAuth = true): Request {
  const body = new Uint8Array(bytes);
  const init: RequestInit = { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } };
  return withAuth ? authed('/api/db/import', init) : new Request(`${BASE}/api/db/import`, init);
}

function wipeDb(): void {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '.prev']) rmSync(`${env.dbPath}${suffix}`, { force: true });
  runMigrations();
}

/** B-029: staged import files must leave no `-wal`/`-shm` sidecars behind, on any outcome. */
function stagedNames(): Set<string> {
  return new Set(readdirSync(dirname(env.dbPath)).filter((name) => name.startsWith('hh-import-')));
}

function seed(): { key: string } {
  createAccount({
    email: 'snap@example.com',
    passwordEnc: encrypt('pw-snap'),
    cookiesEnc: encrypt(JSON.stringify([{ name: 'sessionid', value: 'sess-snap' }])),
    machine: 'machine-snap',
    status: 'active',
    balance: 7,
    granted: 65,
    source: 'bm',
  });
  const key = generateApiKey();
  createKey({ name: 'snap', prefix: key.slice(0, 12), last4: key.slice(-4), keyHash: hashApiKey(key), keyEnc: encrypt(key) });
  setSetting('gateway.rpm_limit', '77');
  setSetting('test.snapshot_marker', '42');
  return { key };
}

async function exportBytes(): Promise<Buffer> {
  const res = await exportDb(authed('/api/db/export'));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-disposition')).toMatch(/hh-db-\d{4}-\d{2}-\d{2}\.db/);
  return Buffer.from(await res.arrayBuffer());
}

beforeEach(() => {
  resetRuns();
  slots.reset();
  wipeDb();
});

afterAll(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '.prev']) rmSync(`${env.dbPath}${suffix}`, { force: true });
  delete process.env.HH_DB_PATH;
});

describe('full database export/import (ADR-026)', () => {
  it('exports a consistent SQLite snapshot with the live data', async () => {
    seed();
    const bytes = await exportBytes();
    expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\u0000');

    const probePath = `${env.dbPath}.probe`;
    writeFileSync(probePath, bytes);
    const probe = new Database(probePath, { readonly: true });
    try {
      const accounts = probe.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number };
      const keys = probe.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number };
      expect(accounts.n).toBe(1);
      expect(keys.n).toBe(1);
    } finally {
      probe.close();
      rmSync(probePath, { force: true });
    }
  });

  it('replaces the whole database: accounts, keys and settings survive', async () => {
    const { key } = seed();
    const bytes = await exportBytes();

    wipeDb();
    expect(getAccountByEmailCI('snap@example.com')).toBeNull();
    expect(getSetting('test.snapshot_marker')).toBeNull();

    const stagedBefore = stagedNames();
    const res = await importDb(binaryRequest(bytes));
    expect(res.status).toBe(200);
    const result = (await res.json()) as { ok: boolean; accounts: number; keys: number; requests: number };
    expect(result.ok).toBe(true);
    expect(result.accounts).toBe(1);
    expect(result.keys).toBe(1);

    const row = getAccountByEmailCI('snap@example.com');
    expect(row?.status).toBe('active');
    expect(decrypt(row?.passwordEnc ?? '')).toBe('pw-snap');
    expect(decrypt(row?.cookiesEnc ?? '')).toBe(JSON.stringify([{ name: 'sessionid', value: 'sess-snap' }]));
    expect(findKeyByHash(hashApiKey(key))?.name).toBe('snap');
    expect(getSetting('gateway.rpm_limit')).toBe('77');
    expect(getSetting('test.snapshot_marker')).toBe('42');
    expect(existsSync(`${env.dbPath}.prev`)).toBe(true);
    expect(readdirSync(dirname(env.dbPath)).filter((n) => n.startsWith('hh-import-') && !stagedBefore.has(n))).toEqual([]);
  });

  it('fails stale jobs imported from the source database', async () => {
    const job = createJob({ type: 'probe', params: {}, total: 1 });
    updateJob(job.id, { status: 'running', startedAt: Date.now() });
    const bytes = await exportBytes();

    wipeDb();
    const res = await importDb(binaryRequest(bytes));
    expect(res.status).toBe(200);
    const imported = getJob(job.id);
    expect(imported?.status).toBe('failed');
    expect(imported?.error).toContain('импортом БД');
  });

  it('rejects bytes that are not a SQLite database', async () => {
    const res = await importDb(binaryRequest(Buffer.from('this is not a database at all')));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_db');
  });

  it('rejects a snapshot encrypted with a different HH_SECRET', async () => {
    createAccount({
      email: 'foreign@example.com',
      passwordEnc: 'v1.Zm9v.YmFy.YmF6',
      status: 'active',
      source: 'bm',
    });
    const bytes = await exportBytes();
    wipeDb();
    const stagedBefore = stagedNames();
    const res = await importDb(binaryRequest(bytes));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('secret_mismatch');
    expect(existsSync(`${env.dbPath}.prev`)).toBe(false);
    expect(readdirSync(dirname(env.dbPath)).filter((n) => n.startsWith('hh-import-') && !stagedBefore.has(n))).toEqual([]);
  });

  it('refuses import while a job or a gateway request is active', async () => {
    const bytes = await exportBytes();

    beginRun(999, 'provision');
    const jobRes = await importDb(binaryRequest(bytes));
    expect(jobRes.status).toBe(409);
    expect(((await jobRes.json()) as { error: { code: string } }).error.code).toBe('job_running');
    endRun(999);

    const release = slots.tryAcquire(1, 'req_snapshot_test');
    const slotRes = await importDb(binaryRequest(bytes));
    expect(slotRes.status).toBe(409);
    expect(((await slotRes.json()) as { error: { code: string } }).error.code).toBe('requests_active');
    release?.();
  });

  it('requires a panel session and rejects an empty body', async () => {
    const anonymous = await importDb(binaryRequest(Buffer.from('x'), false));
    expect(anonymous.status).toBe(401);

    const empty = await importDb(binaryRequest(Buffer.alloc(0)));
    expect(empty.status).toBe(400);
  });
});