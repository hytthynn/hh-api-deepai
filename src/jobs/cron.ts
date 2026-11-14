import 'server-only';
import { getInt } from '@/src/adapters/db/repositories/settings';
import { listForBalanceSync } from '@/src/adapters/db/repositories/accounts';
import { purgeSamples } from '@/src/adapters/db/repositories/balance';
import { failStaleJobs, purgeJobs } from '@/src/adapters/db/repositories/jobs';
import { flushLogs, purgeLogs } from '@/src/adapters/db/repositories/logs';
import { purgeRequests } from '@/src/adapters/db/repositories/requests';
import { purgeResponses } from '@/src/adapters/db/repositories/responses';
import { env } from '@/src/lib/config';
import { logger } from '@/src/lib/logger';
import { modelsSyncDue, syncModels } from './models-sync';
import { probeMany } from './probe';

const TICK_MS = 30_000;
const DAY_MS = 86_400_000;
const MODELS_CHECK_MS = 3_600_000;
const SAMPLE_RETENTION_DAYS = 30;
const JOB_RETENTION_DAYS = 30;

let timer: ReturnType<typeof setInterval> | null = null;
let lastBalanceAt = 0;
let lastModelsCheckAt = 0;
let lastCleanupAt = 0;
let balanceBusy = false;
let modelsBusy = false;

async function runBalanceSync(): Promise<void> {
  if (balanceBusy) return;
  const intervalMs = Math.max(1, getInt('balance.sync_interval_min', 5)) * 60_000;
  if (Date.now() - lastBalanceAt < intervalMs) return;
  balanceBusy = true;
  lastBalanceAt = Date.now();
  try {
    const accounts = listForBalanceSync();
    if (accounts.length === 0) return;
    const results = await probeMany(accounts, 4);
    const failed = results.filter((entry) => !entry.outcome.ok).length;
    logger.info('accounts', `balance sync: ${results.length - failed}/${results.length} ok`, {
      meta: { checked: results.length, failed },
    });
  } catch (error) {
    logger.error('accounts', `balance sync failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    balanceBusy = false;
  }
}

async function runModelsSync(): Promise<void> {
  if (modelsBusy) return;
  if (Date.now() - lastModelsCheckAt < MODELS_CHECK_MS) return;
  lastModelsCheckAt = Date.now();
  if (!modelsSyncDue()) return;
  modelsBusy = true;
  try {
    const outcome = await syncModels();
    if (!outcome.ok) logger.warn('accounts', `models sync failed: ${outcome.error ?? 'unknown'}`);
  } catch (error) {
    logger.error('accounts', `models sync crashed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    modelsBusy = false;
  }
}

function runCleanup(): void {
  if (Date.now() - lastCleanupAt < DAY_MS) return;
  lastCleanupAt = Date.now();
  try {
    flushLogs();
    const logs = purgeLogs(env.logRetentionDays);
    const requests = purgeRequests(env.requestRetentionDays);
    const responses = purgeResponses();
    const samples = purgeSamples(SAMPLE_RETENTION_DAYS);
    const jobs = purgeJobs(JOB_RETENTION_DAYS);
    if (logs + requests + responses + samples + jobs > 0) {
      logger.info('system', 'retention cleanup', {
        meta: { logs, requests, responses, samples, jobs },
      });
    }
  } catch (error) {
    logger.error('system', `cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function tick(): Promise<void> {
  runCleanup();
  await runModelsSync();
  await runBalanceSync();
}

export function startCron(): void {
  if (timer) return;
  try {
    const stale = failStaleJobs('прервано перезапуском приложения');
    if (stale > 0) logger.warn('jobs', `${stale} job(s) marked failed after restart`);
  } catch (error) {
    logger.error('system', `cannot fail stale jobs: ${error instanceof Error ? error.message : String(error)}`);
  }
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
  setTimeout(() => {
    void tick();
  }, 5_000).unref?.();
  logger.info('system', 'cron started', { meta: { tick_ms: TICK_MS } });
}

export function stopCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    flushLogs();
  } catch {
    // shutdown must not throw
  }
}

export function cronRunning(): boolean {
  return timer !== null;
}