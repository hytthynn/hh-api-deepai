import 'server-only';
import type { JobType } from '@/src/core/entities/job';
import { isJobCancelled } from '@/src/adapters/db/repositories/jobs';
import { logger } from '@/src/lib/logger';

type ActiveRun = { type: JobType; startedAt: number };

const active = new Map<number, ActiveRun>();
const cancelRequests = new Set<number>();

/** One runner per job id; a second attempt for the same job is a no-op (SPEC §17.1). */
export function beginRun(id: number, type: JobType): boolean {
  if (active.has(id)) return false;
  cancelRequests.delete(id);
  active.set(id, { type, startedAt: Date.now() });
  return true;
}

export function endRun(id: number): void {
  active.delete(id);
  cancelRequests.delete(id);
}

export function isRunning(id: number): boolean {
  return active.has(id);
}

export function requestCancel(id: number): void {
  if (!active.has(id)) return;
  cancelRequests.add(id);
  logger.info('jobs', `cancel requested for job ${id}`);
}

/** Cancel requested in memory or persisted to `jobs.status` by another request. */
export function cancelRequested(id: number): boolean {
  if (cancelRequests.has(id)) return true;
  try {
    return isJobCancelled(id);
  } catch {
    return false;
  }
}

export function runningJobs(): Array<{ id: number; type: JobType; startedAt: number }> {
  return [...active.entries()].map(([id, run]) => ({ id, ...run }));
}

export function resetRuns(): void {
  active.clear();
  cancelRequests.clear();
}