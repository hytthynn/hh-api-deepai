import 'server-only';
import type { Job } from '@/src/core/entities/job';
import { displayNameFor } from '@/src/core/catalog';
import { classifyFailure } from '@/src/core/gateway/failover';
import { parseModelsPayload, upstream } from '@/src/adapters/upstream/deepai';
import { pickCandidates } from '@/src/adapters/db/repositories/accounts';
import { lastSyncAt, modelCount, upsertModels } from '@/src/adapters/db/repositories/models';
import { createJob, incrementJob, updateJob } from '@/src/adapters/db/repositories/jobs';
import { applyFailure, credentialsOf, markSuccess } from '@/src/server/gateway/accounts';
import { logger } from '@/src/lib/logger';
import { beginRun, endRun } from './runner';

export type SyncOutcome = { ok: boolean; count: number; error: string | null; account: string | null };

const MAX_TRIES = 3;
const SYNC_TTL_MS = 24 * 3_600_000;

/** SPEC §19: refresh on demand and at startup when empty or older than 24 h. */
export function modelsSyncDue(now = Date.now()): boolean {
  if (modelCount() === 0) return true;
  const last = lastSyncAt();
  return last === null || now - last > SYNC_TTL_MS;
}

export async function syncModels(): Promise<SyncOutcome> {
  const candidates = pickCandidates(true).slice(0, MAX_TRIES);
  if (candidates.length === 0) {
    return { ok: false, count: 0, error: 'Нет аккаунтов для синхронизации каталога', account: null };
  }
  const controller = new AbortController();
  let lastError = 'провайдер не вернул каталог';
  for (const account of candidates) {
    try {
      const response = await upstream.models(credentialsOf(account), { signal: controller.signal, timeoutMs: 30_000 });
      if (response.status !== 200) {
        const failure = classifyFailure({
          status: response.status,
          bodyText: typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? ''),
        });
        lastError = `upstream ${response.status} (${failure.code})`;
        applyFailure(account, failure);
        continue;
      }
      const parsed = parseModelsPayload(response.body);
      if (parsed.length === 0) {
        lastError = 'провайдер вернул пустой каталог';
        logger.warn('accounts', 'models sync: empty catalogue, keeping the seeded one');
        continue;
      }
      upsertModels(
        parsed.map((model) => ({
          id: model.id,
          displayName: displayNameFor(model.id),
          free: !model.premier,
          premier: model.premier,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          modalities: model.input,
        })),
      );
      markSuccess(account);
      logger.info('accounts', `models synced: ${parsed.length} models`, {
        accountId: account.id,
        meta: { count: parsed.length },
      });
      return { ok: true, count: parsed.length, error: null, account: account.email };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn('accounts', `models sync via ${account.email} failed: ${lastError}`, { accountId: account.id });
    }
  }
  return { ok: false, count: 0, error: lastError, account: null };
}

export function createModelsSyncJob(): Job {
  return createJob({ type: 'models_sync', params: {}, total: 1 });
}

export async function runModelsSyncJob(jobId: number): Promise<void> {
  if (!beginRun(jobId, 'models_sync')) return;
  updateJob(jobId, { status: 'running', startedAt: Date.now() });
  try {
    const outcome = await syncModels();
    incrementJob(jobId, { done: 1, ok: outcome.ok ? 1 : 0, failed: outcome.ok ? 0 : 1 });
    updateJob(jobId, {
      status: outcome.ok ? 'done' : 'failed',
      error: outcome.ok ? null : (outcome.error ?? 'sync failed').slice(0, 500),
      finishedAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJob(jobId, { status: 'failed', error: message.slice(0, 500), finishedAt: Date.now() });
    logger.error('jobs', `models sync job ${jobId} failed: ${message}`, { meta: { job_id: jobId } });
  } finally {
    endRun(jobId);
  }
}