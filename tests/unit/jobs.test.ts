import { beforeEach, describe, expect, it, vi } from 'vitest';

let chromeOk = false;
const registerCalls: Array<{ email: string; signal?: AbortSignal }> = [];

vi.mock('@/src/server/engine', () => ({
  engineHealth: async () => ({
    python: '3.12.4',
    playwright: '1.49.0',
    chrome: chromeOk ? 'C:/chrome.exe' : '',
    chrome_ok: chromeOk,
  }),
  enginePool: () => ({
    register: (command: { email: string; signal?: AbortSignal }) => {
      registerCalls.push(command);
      return new Promise((_resolve, reject) => {
        const abort = (): void => {
          const error = new Error('register aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (command.signal?.aborted) abort();
        else command.signal?.addEventListener('abort', abort, { once: true });
      });
    },
  }),
}));

vi.mock('@/src/adapters/bm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/adapters/bm/client')>();
  class FakeBmClient {
    async wallet(): Promise<{ balance: number }> {
      return { balance: 10 };
    }

    async product(id: number): Promise<{
      id: number;
      name: string;
      price: number;
      inStock: boolean;
      allowedQuantities: number[];
    }> {
      return { id, name: 'Google 24h', price: 0.5, inStock: true, allowedQuantities: [1, 2, 5, 10] };
    }

    async createOrder(
      _id: number,
      quantity: number,
    ): Promise<{ id: number; status: string; totalAmount: number; items: string[] }> {
      return {
        id: 900,
        status: 'completed',
        totalAmount: 0.5 * quantity,
        items: ['job-test@ecolu.us|secret-pass'],
      };
    }

    async getOrder(): Promise<{ status: string; items: string[] }> {
      return { status: 'completed', items: ['job-test@ecolu.us|secret-pass'] };
    }

    async purchases(): Promise<string[]> {
      return [];
    }
  }
  return { ...actual, BmClient: FakeBmClient };
});

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import {
  addJobItem,
  cancelJob,
  createJob,
  failStaleJobs,
  getJob,
  listJobItems,
  updateJob,
} from '@/src/adapters/db/repositories/jobs';
import { setSetting } from '@/src/adapters/db/repositories/settings';
import { beginRun, cancelRequested, requestCancel, resetRuns } from '@/src/jobs/runner';
import { runProvisionJob } from '@/src/jobs/provision';

beforeEach(() => {
  closeDb();
  runMigrations();
  setSetting('bm.api_key', 'test-bm-key');
  setSetting('engine.workers', '1');
  resetRuns();
  registerCalls.length = 0;
  chromeOk = false;
});

describe('provision preflight', () => {
  it('fails before purchase when Chrome is unavailable', async () => {
    const job = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });

    await runProvisionJob(job.id);

    const fresh = getJob(job.id);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.error).toMatch(/браузер для регистрации не найден/i);
    expect(fresh?.spentUsd).toBe(0);
    expect(listJobItems(job.id)).toHaveLength(0);
    expect(registerCalls).toHaveLength(0);
  });
});

describe('job cancellation', () => {
  it('persists cancelled status even when the runner lives in another module graph', () => {
    const job = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    beginRun(job.id, 'provision');
    updateJob(job.id, { status: 'running' });

    expect(cancelRequested(job.id)).toBe(false);
    expect(cancelJob(job.id)).toBe(true);
    expect(getJob(job.id)?.status).toBe('cancelled');
    // No in-memory flag was set, so this can only come from the persisted row.
    expect(cancelRequested(job.id)).toBe(true);
  });

  it('sees an in-memory cancel request from the same process', () => {
    const job = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    beginRun(job.id, 'provision');
    requestCancel(job.id);
    expect(cancelRequested(job.id)).toBe(true);
  });

  it('aborts an in-flight registration and keeps the purchased login for resume', async () => {
    chromeOk = true;
    const job = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    const running = runProvisionJob(job.id);

    await vi.waitFor(() => expect(registerCalls).toHaveLength(1), { timeout: 5_000, interval: 25 });
    const item = listJobItems(job.id)[0];
    expect(item?.stage).toBe('registering');

    cancelJob(job.id);
    requestCancel(job.id);

    await running;

    const fresh = getJob(job.id);
    expect(fresh?.status).toBe('cancelled');
    expect(fresh?.done).toBe(0);
    expect(fresh?.failed).toBe(0);
    expect(fresh?.spentUsd).toBeCloseTo(0.5, 6);

    // `purchased` (not `registering`) so `resumeJobId` picks the paid login up again.
    const after = listJobItems(job.id)[0];
    expect(after?.stage).toBe('purchased');
    expect(after?.error).toBe('cancelled');
  });
});

describe('job item reuse', () => {
  it('does not count an already registered email twice', () => {
    const job = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    addJobItem(job.id, { email: 'dup@ecolu.us', stage: 'failed' });
    expect(listJobItems(job.id)).toHaveLength(1);
  });
});

describe('restart recovery', () => {
  it('fails queued and running jobs after a restart, leaves finished ones alone', () => {
    const queued = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    const running = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    updateJob(running.id, { status: 'running' });
    const done = createJob({ type: 'provision', params: { type: 'provision', quantity: 1 }, total: 1 });
    updateJob(done.id, { status: 'done' });

    expect(failStaleJobs('прервано перезапуском приложения')).toBe(2);

    const failedQueued = getJob(queued.id);
    expect(failedQueued?.status).toBe('failed');
    expect(failedQueued?.error).toBe('прервано перезапуском приложения');
    expect(failedQueued?.finishedAt).toBeGreaterThan(0);
    expect(getJob(running.id)?.status).toBe('failed');
    expect(getJob(done.id)?.status).toBe('done');
    expect(getJob(done.id)?.error).toBeNull();
  });
});