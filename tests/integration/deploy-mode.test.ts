import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-025: env must be set before any module reads `env` (config is parsed at import).
vi.hoisted(() => {
  process.env.HH_MODE = 'gateway';
  process.env.HH_PUBLIC_ORIGIN = 'https://hh.example.test';
});

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createAccount, getAccountByEmailCI } from '@/src/adapters/db/repositories/accounts';
import { decrypt, encrypt } from '@/src/lib/crypto';
import { SESSION_COOKIE, signSession } from '@/src/server/auth';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as getSettings } from '@/app/api/settings/route';
import { GET as getEngine } from '@/app/api/engine/route';
import { GET as getOverview } from '@/app/api/overview/route';
import { POST as postJobs } from '@/app/api/jobs/route';
import { POST as importAccounts } from '@/app/api/accounts/import/route';
import { GET as exportAccounts } from '@/app/api/accounts/export/route';

const PUBLIC_ORIGIN = 'https://hh.example.test';

function authed(path: string, init: RequestInit = {}, base = PUBLIC_ORIGIN): Request {
  return new Request(`${base}${path}`, {
    ...init,
    headers: {
      cookie: `${SESSION_COOKIE}=${signSession()}`,
      'content-type': 'application/json',
      origin: base,
      ...(init.headers ?? {}),
    },
  });
}

function seedTransferable(): void {
  createAccount({
    email: 'a@example.com',
    passwordEnc: encrypt('pw-a'),
    cookiesEnc: encrypt(JSON.stringify([{ name: 'sessionid', value: 'sess-a' }])),
    machine: 'machine-a',
    status: 'active',
    balance: 12.5,
    granted: 50,
    refreshAt: '2026-11-17T00:00:00.000Z',
    laneVersion: 3,
    source: 'bm',
  });
}

beforeEach(() => {
  closeDb();
  runMigrations();
});

afterAll(() => {
  // Same worker process runs the next file: gateway env must not leak (vitest fileParallelism:false).
  delete process.env.HH_MODE;
  delete process.env.HH_PUBLIC_ORIGIN;
  closeDb();
});

describe('gateway mode (ADR-025)', () => {
  it('accepts the public origin for mutations and rejects foreign ones', async () => {
    const ok = await login(
      new Request(`${PUBLIC_ORIGIN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PUBLIC_ORIGIN },
        body: JSON.stringify({ password: 'test-admin-password' }),
      }),
    );
    expect(ok.status).toBe(200);

    const evil = await login(
      new Request(`${PUBLIC_ORIGIN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
        body: JSON.stringify({ password: 'test-admin-password' }),
      }),
    );
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe('csrf_failed');
  });

  it('marks the session cookie Secure on https public origin', async () => {
    const res = await login(
      new Request(`${PUBLIC_ORIGIN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PUBLIC_ORIGIN },
        body: JSON.stringify({ password: 'test-admin-password' }),
      }),
    );
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('exposes mode in settings, engine and overview', async () => {
    const settings = (await (await getSettings(authed('/api/settings'))).json()) as { mode: string };
    expect(settings.mode).toBe('gateway');

    const engine = (await (await getEngine(authed('/api/engine'))).json()) as {
      mode: string;
      health: unknown;
    };
    expect(engine.mode).toBe('gateway');
    expect(engine.health).toBeNull();

    const overview = (await (await getOverview(authed('/api/overview'))).json()) as {
      runtime: { mode: string };
    };
    expect(overview.runtime.mode).toBe('gateway');
  });

  it('refuses provision and text import with engine_disabled', async () => {
    const provision = await postJobs(
      authed('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'provision', quantity: 1 }) }),
    );
    expect(provision.status).toBe(400);
    expect(((await provision.json()) as { error: { code: string } }).error.code).toBe('engine_disabled');

    const textImport = await importAccounts(
      authed('/api/accounts/import', { method: 'POST', body: JSON.stringify({ text: 'x@y.z|pw' }) }),
    );
    expect(textImport.status).toBe(400);
    expect(((await textImport.json()) as { error: { code: string } }).error.code).toBe('engine_disabled');
  });

  it('exports a transfer file and imports it into a fresh database', async () => {
    seedTransferable();
    const exported = await exportAccounts(authed('/api/accounts/export?format=transfer'));
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('application/json');
    const transfer = (await exported.json()) as {
      format: string;
      version: number;
      accounts: Array<{ email: string; passwordEnc: string; cookiesEnc: string | null }>;
    };
    expect(transfer.format).toBe('hh-api-transfer');
    expect(transfer.version).toBe(1);
    expect(transfer.accounts).toHaveLength(1);
    expect(transfer.accounts[0]?.passwordEnc.startsWith('v1.')).toBe(true);
    expect(transfer.accounts[0]?.cookiesEnc?.startsWith('v1.')).toBe(true);

    closeDb();
    runMigrations();
    expect(getAccountByEmailCI('a@example.com')).toBeNull();

    const imported = await importAccounts(
      authed('/api/accounts/import', { method: 'POST', body: JSON.stringify({ transfer }) }),
    );
    expect(imported.status).toBe(200);
    const result = (await imported.json()) as {
      jobId: number | null;
      created: number;
      skipped: string[];
      invalid: string[];
      total: number;
    };
    expect(result).toEqual({ jobId: null, created: 1, skipped: [], invalid: [], total: 1 });

    const row = getAccountByEmailCI('a@example.com');
    expect(row).not.toBeNull();
    expect(row?.status).toBe('active');
    expect(row?.source).toBe('transfer');
    expect(row?.balance).toBe(12.5);
    expect(row?.granted).toBe(50);
    expect(row?.machine).toBe('machine-a');
    expect(row?.laneVersion).toBe(3);
    expect(row?.refreshAt).toBe('2026-11-17T00:00:00.000Z');
    expect(decrypt(row?.cookiesEnc ?? '')).toBe(JSON.stringify([{ name: 'sessionid', value: 'sess-a' }]));
    expect(decrypt(row?.passwordEnc ?? '')).toBe('pw-a');
  });

  it('dedupes transfer import by email, case-insensitively', async () => {
    seedTransferable();
    const transfer = await (await exportAccounts(authed('/api/accounts/export?format=transfer'))).json();
    const res = await importAccounts(
      authed('/api/accounts/import', { method: 'POST', body: JSON.stringify({ transfer }) }),
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { created: number; skipped: string[]; total: number };
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual(['a@example.com']);
    expect(result.total).toBe(1);
  });

  it('rejects a malformed transfer payload', async () => {
    const res = await importAccounts(
      authed('/api/accounts/import', {
        method: 'POST',
        body: JSON.stringify({ transfer: { format: 'nope', version: 1, accounts: [] } }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });
});