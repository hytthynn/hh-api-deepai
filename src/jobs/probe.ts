import 'server-only';
import type { Account } from '@/src/core/entities/account';
import type { Job } from '@/src/core/entities/job';
import type { ChatRequest } from '@/src/core/gateway/types';
import { parseTheos } from '@/src/core/accounts/balance';
import { reduceAccount } from '@/src/core/accounts/state';
import { classifyFailure } from '@/src/core/gateway/failover';
import { upstream } from '@/src/adapters/upstream/deepai';
import {
  createJob,
  addJobItem,
  incrementJob,
  isJobCancelled,
  listJobs,
  updateJob,
  updateJobItem,
} from '@/src/adapters/db/repositories/jobs';
import {
  getAccount,
  listForBalanceSync,
  updateAccount,
} from '@/src/adapters/db/repositories/accounts';
import { addBalanceSample } from '@/src/adapters/db/repositories/balance';
import { getModel, listModels } from '@/src/adapters/db/repositories/models';
import { credentialsOf, applyFailure } from '@/src/server/gateway/accounts';
import { logger } from '@/src/lib/logger';
import { beginRun, endRun } from './runner';

export type ProbeOutcome = {
  ok: boolean;
  reason: string | null;
  balance: number;
  granted: number;
  refreshAt: string | null;
};

const THEOS_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 60_000;

function probeChatModel(): string | null {
  const preferred = getModel('glm-5.3-flash');
  if (preferred?.enabled) return preferred.id;
  const free = listModels(false).find((model) => model.free);
  return free?.id ?? null;
}

async function chatCheck(account: Account, signal: AbortSignal): Promise<{ ok: boolean; reason: string | null }> {
  const model = probeChatModel();
  if (!model) return { ok: true, reason: null };
  const request: ChatRequest = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    stream: false,
    maxTokens: 16,
    protocol: 'chat',
  };
  try {
    await upstream.complete(credentialsOf(account), request, { signal, timeoutMs: CHAT_TIMEOUT_MS });
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * SPEC §16.5 / §17.1: `/theos` drives status; an optional one-token chat proves the
 * session cookies work before the account is marked `active`.
 */
export async function probeAccount(
  account: Account,
  options: { chat?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await upstream.theos(credentialsOf(account), {
      signal: controller.signal,
      timeoutMs: options.timeoutMs ?? THEOS_TIMEOUT_MS,
    });
    if (response.status !== 200) {
      const failure = classifyFailure({
        status: response.status,
        bodyText: typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? ''),
      });
      applyFailure(account, failure);
      logger.warn('accounts', `probe ${account.email} failed: ${failure.code}`, {
        accountId: account.id,
        meta: { status: response.status },
      });
      return { ok: false, reason: failure.code, balance: account.balance, granted: account.granted, refreshAt: account.refreshAt };
    }

    const snapshot = parseTheos(response.body);
    const patch = reduceAccount(account, {
      type: 'probe_ok',
      balance: snapshot.balance,
      granted: snapshot.granted,
      refreshAt: snapshot.refreshAt,
      laneVersion: snapshot.laneVersion ?? account.laneVersion,
    });
    updateAccount(account.id, patch);
    addBalanceSample({
      accountId: account.id,
      balance: snapshot.balance,
      granted: snapshot.granted,
      refreshAt: snapshot.refreshAt,
    });

    if (options.chat) {
      const chat = await chatCheck(account, controller.signal);
      if (!chat.ok) {
        logger.warn('accounts', `probe chat failed for ${account.email}: ${chat.reason ?? 'unknown'}`, {
          accountId: account.id,
        });
        return { ok: false, reason: 'chat_failed', balance: snapshot.balance, granted: snapshot.granted, refreshAt: snapshot.refreshAt };
      }
    }

    logger.info('accounts', `probe ${account.email} ok: ${snapshot.balance} theos`, {
      accountId: account.id,
      meta: { balance: snapshot.balance, lane_version: snapshot.laneVersion },
    });
    return { ok: true, reason: null, balance: snapshot.balance, granted: snapshot.granted, refreshAt: snapshot.refreshAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = classifyFailure({ status: null, bodyText: message, network: true });
    applyFailure(account, failure);
    logger.warn('accounts', `probe ${account.email} network error: ${message}`, { accountId: account.id });
    return { ok: false, reason: failure.code, balance: account.balance, granted: account.granted, refreshAt: account.refreshAt };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function probeMany(accounts: Account[], concurrency = 4): Promise<Array<{ account: Account; outcome: ProbeOutcome }>> {
  const queue = [...accounts];
  const results: Array<{ account: Account; outcome: ProbeOutcome }> = [];
  const workers = Math.max(1, Math.min(concurrency, queue.length || 1));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const account = queue.shift();
        if (!account) return;
        const outcome = await probeAccount(account);
        results.push({ account, outcome });
      }
    }),
  );
  return results;
}

export function createProbeJob(accountIds: number[] | null): Job {
  const ids = accountIds ?? listForBalanceSync().map((account) => account.id);
  return createJob({ type: 'probe', params: { accountIds: ids }, total: ids.length });
}

export function activeProbeJob(): Job | null {
  return listJobs(50).find((job) => job.type === 'probe' && (job.status === 'queued' || job.status === 'running')) ?? null;
}

export async function runProbeJob(jobId: number): Promise<void> {
  if (!beginRun(jobId, 'probe')) return;
  const startedAt = Date.now();
  updateJob(jobId, { status: 'running', startedAt });
  let ok = 0;
  let failed = 0;
  try {
    const job = listJobs(500).find((entry) => entry.id === jobId);
    const params = job ? (JSON.parse(job.params) as { accountIds?: number[] }) : {};
    const ids = params.accountIds ?? [];
    for (const id of ids) {
      if (isJobCancelled(jobId)) break;
      const account = getAccount(id);
      if (!account) {
        incrementJob(jobId, { done: 1, failed: 1 });
        failed += 1;
        continue;
      }
      const item = addJobItem(jobId, { email: account.email, stage: 'probing' });
      const outcome = await probeAccount(account);
      updateJobItem(item.id, { stage: outcome.ok ? 'ok' : 'failed', error: outcome.reason });
      incrementJob(jobId, { done: 1, ok: outcome.ok ? 1 : 0, failed: outcome.ok ? 0 : 1 });
      if (outcome.ok) ok += 1;
      else failed += 1;
    }
    updateJob(jobId, { status: isJobCancelled(jobId) ? 'cancelled' : 'done', finishedAt: Date.now() });
    logger.info('jobs', `probe job ${jobId} finished: ${ok} ok, ${failed} failed`, {
      meta: { job_id: jobId, ok, failed, ms: Date.now() - startedAt },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJob(jobId, { status: 'failed', error: message.slice(0, 500), finishedAt: Date.now() });
    logger.error('jobs', `probe job ${jobId} failed: ${message}`, { meta: { job_id: jobId } });
  } finally {
    endRun(jobId);
  }
}