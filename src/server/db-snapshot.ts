import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import {
  discardSnapshot,
  exportSnapshot,
  inspectSnapshot,
  installSnapshot,
  stageSnapshot,
  type SnapshotInspection,
} from '@/src/adapters/db/snapshot';
import { failStaleJobs } from '@/src/adapters/db/repositories/jobs';
import { accounts, apiKeys, locks, requests } from '@/src/adapters/db/schema';
import { resetRateLimits } from '@/src/lib/rate-limit';
import { decrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import { resetRuns, runningJobs } from '@/src/jobs/runner';
import { ApiError } from './api';
import { slots } from './slots';

/** SPEC §17.6 (ADR-026): full-database export/import orchestration. */

export type DbImportResult = { ok: true; accounts: number; keys: number; requests: number };

export async function exportDatabase(): Promise<{ bytes: Buffer; filename: string }> {
  const bytes = await exportSnapshot();
  const stamp = new Date().toISOString().slice(0, 10);
  return { bytes, filename: `hh-db-${stamp}.db` };
}

function countRows(table: typeof accounts | typeof apiKeys | typeof requests): number {
  return db().select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
}

export function importDatabase(bytes: Buffer): DbImportResult {
  if (runningJobs().length > 0) {
    throw new ApiError('job_running', 409, 'Сейчас выполняется джоба. Дождитесь завершения или отмените её, затем повторите импорт.');
  }
  if (slots.size() > 0) {
    throw new ApiError('requests_active', 409, 'Есть активные запросы шлюза. Дождитесь их завершения, затем повторите импорт.');
  }

  let staged: string;
  try {
    staged = stageSnapshot(bytes);
  } catch (error) {
    throw new ApiError('invalid_db', 400, error instanceof Error ? error.message : String(error));
  }

  try {
    let inspection: SnapshotInspection;
    try {
      inspection = inspectSnapshot(staged);
    } catch (error) {
      throw new ApiError('invalid_db', 400, error instanceof Error ? error.message : String(error));
    }
    try {
      if (inspection.passwordSample) decrypt(inspection.passwordSample);
      if (inspection.settingSample) decrypt(inspection.settingSample);
    } catch {
      throw new ApiError(
        'secret_mismatch',
        400,
        'Файл зашифрован другим HH_SECRET. Задайте на этом экземпляре тот же HH_SECRET, что на источнике, и повторите.',
      );
    }
    installSnapshot(staged);
  } catch (error) {
    discardSnapshot(staged);
    throw error;
  }

  runMigrations();
  const stale = failStaleJobs('прервано импортом БД');
  resetRuns();
  slots.reset();
  resetRateLimits();
  // The imported locks row belongs to the source process; re-own it so the heartbeat keeps it fresh.
  db().update(locks).set({ pid: process.pid, ts: Date.now() }).where(sql`${locks.name} = 'hh-api'`).run();

  const result: DbImportResult = {
    ok: true,
    accounts: countRows(accounts),
    keys: countRows(apiKeys),
    requests: countRows(requests),
  };
  logger.info(
    'ui',
    `database imported: accounts=${result.accounts} keys=${result.keys} requests=${result.requests} stale_jobs=${stale}`,
  );
  return result;
}