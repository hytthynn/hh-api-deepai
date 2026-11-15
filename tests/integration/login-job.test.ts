import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/adapters/upstream/headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/adapters/upstream/headers')>();
  return { ...actual, API_BASE: 'http://127.0.0.1:3212' };
});

const engine = vi.hoisted(() => ({
  ready: true,
  chromeOk: true,
  calls: [] as Array<{ email: string; password: string }>,
}));

vi.mock('@/src/server/engine', () => ({
  engineHealth: async () =>
    engine.ready
      ? { python: '3.12.4', playwright: '1.49.0', chrome: 'C:/chrome.exe', chrome_ok: engine.chromeOk }
      : null,
  engineSettings: () => ({ workers: 1, restartAfter: 10, headless: true, proxy: null }),
  enginePool: () => ({
    register: async (command: { email: string; password: string }) => {
      engine.calls.push({ email: command.email, password: command.password });
      return {
        ok: true,
        stage: 'ok',
        cookies: [{ name: 'sessionid', value: `session-${command.email}`, domain: 'deepai.org' }],
        machine: `machine-${command.email}`,
        theosStatus: 200,
        theos: null,
        laneVersion: 4,
        ms: 5,
      };
    },
  }),
  shutdownEngine: async () => undefined,
}));

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import {
  createAccount,
  getAccount,
  getAccountByEmail,
  getAccountByEmailCI,
  listAccounts,
} from '@/src/adapters/db/repositories/accounts';
import { getJob, listJobItems } from '@/src/adapters/db/repositories/jobs';
import { decrypt, encrypt } from '@/src/lib/crypto';
import { resetRuns } from '@/src/jobs/runner';
import { createLoginJob, importAccounts, runLoginJob } from '@/src/jobs/login';
import { startUpstream, type UpstreamMock } from '../fixtures/upstream';

let upstreamMock: UpstreamMock;

beforeAll(async () => {
  upstreamMock = await startUpstream(3212);
});

afterAll(async () => {
  await upstreamMock.close();
  closeDb();
});

beforeEach(() => {
  closeDb();
  runMigrations();
  upstreamMock.reset();
  resetRuns();
  engine.ready = true;
  engine.chromeOk = true;
  engine.calls.length = 0;
});

describe('SPEC §17.4: import logs in every account', () => {
  it('creates pending rows and authenticates each of them', async () => {
    const result = importAccounts(
      'imp-one@example.test|first-pass\nimp-two@example.test|second-pass\nbroken-line',
    );

    expect(result.created).toBe(2);
    expect(result.invalid).toEqual(['broken-line']);
    expect(result.total).toBe(3);
    expect(result.jobId).not.toBeNull();

    const queued = getAccountByEmail('imp-one@example.test');
    expect(queued?.status).toBe('pending');
    expect(queued?.source).toBe('import');
    expect(queued?.cookiesEnc).toBeNull();

    await runLoginJob(result.jobId!);

    const job = getJob(result.jobId!);
    expect(job?.type).toBe('login');
    expect(job?.status).toBe('done');
    expect(job?.total).toBe(2);
    expect(job?.done).toBe(2);
    expect(job?.ok).toBe(2);
    expect(job?.failed).toBe(0);
    expect(job?.spentUsd).toBe(0);

    expect(engine.calls).toEqual([
      { email: 'imp-one@example.test', password: 'first-pass' },
      { email: 'imp-two@example.test', password: 'second-pass' },
    ]);

    const fresh = getAccountByEmail('imp-one@example.test');
    expect(fresh?.status).toBe('active');
    expect(fresh?.cookiesEnc).not.toBeNull();
    expect(fresh?.machine).toBe('machine-imp-one@example.test');
    expect(fresh?.passwordEnc).not.toBeNull();
    expect(decrypt(fresh!.passwordEnc!)).toBe('first-pass');

    const items = listJobItems(result.jobId!);
    expect(items.map((item) => item.stage)).toEqual(['ok', 'ok']);
    expect(items.map((item) => item.accountId)).toEqual([fresh?.id, getAccountByEmail('imp-two@example.test')?.id]);
    expect(upstreamMock.calls.filter((call) => call.path.endsWith('/theos'))).toHaveLength(2);
  });

  it('reuses an existing account instead of creating a duplicate row', () => {
    const first = importAccounts('dup@example.test|one');
    expect(first.created).toBe(1);

    const again = importAccounts('DUP@example.test|two');
    expect(again.created).toBe(0);
    expect(again.jobId).toBeNull();
    expect(again.skipped).toEqual(['DUP@example.test']);
    expect(listAccounts({}).total).toBe(1);
    expect(getAccountByEmailCI('dup@example.test')?.email).toBe('dup@example.test');
  });

  it('fails the job before touching any account when Chrome is missing', async () => {
    engine.chromeOk = false;
    const account = createAccount({
      email: 'no-chrome@example.test',
      passwordEnc: encrypt('secret'),
      status: 'pending',
      source: 'import',
    });
    const job = createLoginJob([account.id]);

    await runLoginJob(job.id);

    const fresh = getJob(job.id);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.error).toMatch(/браузер для регистрации не найден/i);
    expect(fresh?.done).toBe(0);
    expect(engine.calls).toHaveLength(0);

    const untouched = getAccount(account.id);
    expect(untouched?.status).toBe('pending');
    expect(untouched?.cookiesEnc).toBeNull();
    expect(listJobItems(job.id)).toHaveLength(0);
  });

  it('reports an account without a stored password instead of opening a browser', async () => {
    const account = createAccount({
      email: 'no-password@example.test',
      passwordEnc: null,
      status: 'pending',
      source: 'import',
    });
    const job = createLoginJob([account.id]);

    await runLoginJob(job.id);

    const fresh = getJob(job.id);
    expect(fresh?.status).toBe('done');
    expect(fresh?.done).toBe(1);
    expect(fresh?.failed).toBe(1);
    expect(engine.calls).toHaveLength(0);

    const items = listJobItems(job.id);
    expect(items[0]?.stage).toBe('failed');
    expect(items[0]?.error).toBe('no_password');
    expect(getAccount(account.id)?.status).toBe('pending');
  });

  it('marks a missing account as a failed item', async () => {
    const job = createLoginJob([9_999]);

    await runLoginJob(job.id);

    const fresh = getJob(job.id);
    expect(fresh?.status).toBe('done');
    expect(fresh?.failed).toBe(1);
    const items = listJobItems(job.id);
    expect(items[0]?.stage).toBe('failed');
    expect(items[0]?.error).toBe('account_not_found');
    expect(engine.calls).toHaveLength(0);
  });
});