import 'server-only';
import type { JobType } from '@/src/core/entities/job';
import { isJobCancelled } from '@/src/adapters/db/repositories/jobs';
import { globalState } from '@/src/lib/global-state';
import { logger } from '@/src/lib/logger';

type ActiveRun = { type: JobType; startedAt: number; controller: AbortController };

type RunnerState = {
  active: Map<number, ActiveRun>;
  cancelRequests: Set<number>;
};

/** Shared across module graphs (ADR-017): a route handler must see the job its sibling started. */
function state(): RunnerState {
  return globalState<RunnerState>('job-runner', () => ({ active: new Map(), cancelRequests: new Set() }));
}

/** One runner per job id; a second attempt for the same job is a no-op (SPEC §17.1). */
export function beginRun(id: number, type: JobType): boolean {
  const current = state();
  if (current.active.has(id)) return false;
  current.cancelRequests.delete(id);
  current.active.set(id, { type, startedAt: Date.now(), controller: new AbortController() });
  return true;
}

export function endRun(id: number): void {
  const current = state();
  const run = current.active.get(id);
  current.active.delete(id);
  current.cancelRequests.delete(id);
  if (run && !run.controller.signal.aborted) run.controller.abort();
}

export function isRunning(id: number): boolean {
  return state().active.has(id);
}

/** Aborts the in-flight engine call of a running job; also used for cross-graph signalling. */
export function requestCancel(id: number): void {
  const current = state();
  current.cancelRequests.add(id);
  const run = current.active.get(id);
  if (run && !run.controller.signal.aborted) run.controller.abort();
  logger.info('jobs', `cancel requested for job ${id}`);
}

/** Signal for the current run; an already-aborted signal if the job is not running here. */
export function runSignal(id: number): AbortSignal {
  return state().active.get(id)?.controller.signal ?? AbortSignal.abort();
}

/** Cancel requested in memory or persisted to `jobs.status` by another request. */
export function cancelRequested(id: number): boolean {
  if (state().cancelRequests.has(id)) return true;
  try {
    return isJobCancelled(id);
  } catch {
    return false;
  }
}

export function runningJobs(): Array<{ id: number; type: JobType; startedAt: number }> {
  return [...state().active.entries()].map(([id, run]) => ({
    id,
    type: run.type,
    startedAt: run.startedAt,
  }));
}

export function resetRuns(): void {
  const current = state();
  current.active.clear();
  current.cancelRequests.clear();
}