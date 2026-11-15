import 'server-only';
import type { Account } from '@/src/core/entities/account';
import type { Job, JobItem } from '@/src/core/entities/job';
import type { ParsedLogin } from '@/src/core/ports/bm';
import { parseLogins } from '@/src/adapters/bm/client';
import {
  createAccount,
  getAccount,
  getAccountByEmailCI,
} from '@/src/adapters/db/repositories/accounts';
import {
  addJobItem,
  createJob,
  getJob,
  incrementJob,
  updateJob,
  updateJobItem,
} from '@/src/adapters/db/repositories/jobs';
import { decrypt, encrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import { engineSettings } from '@/src/server/engine';
import { EngineNotReadyError, assertEngineReady, isAbort, runAuthQueue } from './auth';
import { beginRun, cancelRequested, endRun, runSignal } from './runner';

export type LoginParams = { accountIds: number[] };

export type ImportResult = {
  jobId: number | null;
  created: number;
  skipped: string[];
  invalid: string[];
  total: number;
};

/** SPEC §17.4: authenticates already stored logins — no BM purchase, no money involved. */
export function createLoginJob(accountIds: number[]): Job {
  return createJob({ type: 'login', params: { accountIds }, total: accountIds.length });
}

/**
 * Import is not just a database write: a row without cookies cannot serve a single request,
 * so every new login is queued for the same OAuth+probe pipeline `provision` uses (§17.3).
 */
export function importAccounts(text: string): ImportResult {
  const { parsed, invalid } = parseLogins(text.split(/\r?\n/));
  const skipped: string[] = [];
  const accountIds: number[] = [];
  for (const login of parsed) {
    if (getAccountByEmailCI(login.email)) {
      skipped.push(login.email);
      continue;
    }
    try {
      const account = createAccount({
        email: login.email,
        passwordEnc: encrypt(login.password),
        status: 'pending',
        source: 'import',
      });
      accountIds.push(account.id);
    } catch {
      skipped.push(login.email);
    }
  }
  const job = accountIds.length > 0 ? createLoginJob(accountIds) : null;
  return { jobId: job?.id ?? null, created: accountIds.length, skipped, invalid, total: parsed.length + invalid.length };
}

function readPassword(account: Account): string | null {
  if (!account.passwordEnc) return null;
  try {
    return decrypt(account.passwordEnc);
  } catch {
    return null;
  }
}

/** SPEC §17.4. Cancelled items fall back to `queued`, so a repeated import can retry them. */
export async function runLoginJob(jobId: number): Promise<void> {
  if (!beginRun(jobId, 'login')) return;
  updateJob(jobId, { status: 'running', startedAt: Date.now() });
  const signal = runSignal(jobId);
  try {
    const job = getJob(jobId);
    if (!job) throw new Error(`job ${jobId} disappeared`);
    const params = JSON.parse(job.params) as LoginParams;
    const ids = Array.isArray(params.accountIds)
      ? params.accountIds.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    updateJob(jobId, { total: ids.length });

    await assertEngineReady();

    const settings = engineSettings();
    const queue: JobItem[] = [];
    const logins = new Map<number, ParsedLogin>();

    for (const accountId of ids) {
      if (cancelRequested(jobId)) break;
      const account = getAccount(accountId);
      const item = addJobItem(jobId, { email: account?.email ?? null, stage: 'queued' });
      if (!account) {
        updateJobItem(item.id, { stage: 'failed', error: 'account_not_found' });
        incrementJob(jobId, { done: 1, failed: 1 });
        continue;
      }
      updateJobItem(item.id, { accountId: account.id });
      const password = readPassword(account);
      if (!password) {
        updateJobItem(item.id, { stage: 'failed', error: 'no_password' });
        incrementJob(jobId, { done: 1, failed: 1 });
        continue;
      }
      logins.set(item.id, { email: account.email, password });
      queue.push(item);
    }

    if (!cancelRequested(jobId) && queue.length > 0) {
      await runAuthQueue(jobId, queue, logins, {
        workers: settings.workers,
        headless: settings.headless,
        proxy: settings.proxy,
        signal,
        source: 'import',
        cancelStage: 'queued',
      });
    }

    const cancelled = cancelRequested(jobId);
    updateJob(jobId, { status: cancelled ? 'cancelled' : 'done', finishedAt: Date.now() });
    logger.info('jobs', `login ${jobId} ${cancelled ? 'cancelled' : 'finished'}`, { meta: { job_id: jobId } });
  } catch (error) {
    if (isAbort(error, signal)) {
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
      logger.info('jobs', `login ${jobId} cancelled`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof EngineNotReadyError ? error.code : 'login_failed';
    updateJob(jobId, { status: 'failed', error: message.slice(0, 500), finishedAt: Date.now() });
    logger.error('jobs', `login ${jobId} failed (${code}): ${message}`, { meta: { job_id: jobId, code } });
  } finally {
    endRun(jobId);
  }
}