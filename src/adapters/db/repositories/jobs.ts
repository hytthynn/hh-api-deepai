import 'server-only';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Job, JobItem, JobStatus, JobType } from '@/src/core/entities/job';
import { db } from '../client';
import { jobItems, jobs } from '../schema';

function toJob(row: typeof jobs.$inferSelect): Job {
  return { ...row, type: row.type as JobType, status: row.status as JobStatus };
}

function toItem(row: typeof jobItems.$inferSelect): JobItem {
  return { ...row };
}

export function createJob(input: { type: JobType; params: unknown; total: number }): Job {
  const row = db()
    .insert(jobs)
    .values({
      type: input.type,
      status: 'queued',
      params: JSON.stringify(input.params),
      total: input.total,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  return toJob(row);
}

export function getJob(id: number): Job | null {
  const row = db().select().from(jobs).where(eq(jobs.id, id)).get();
  return row ? toJob(row) : null;
}

export function listJobs(limit = 20): Job[] {
  return db().select().from(jobs).orderBy(desc(jobs.id)).limit(limit).all().map(toJob);
}

export function updateJob(
  id: number,
  patch: Partial<{
    status: JobStatus;
    total: number;
    done: number;
    ok: number;
    failed: number;
    spentUsd: number;
    error: string | null;
    startedAt: number;
    finishedAt: number;
  }>,
): void {
  db().update(jobs).set(patch).where(eq(jobs.id, id)).run();
}

export function incrementJob(
  id: number,
  delta: { done?: number; ok?: number; failed?: number; spentUsd?: number },
): void {
  db()
    .update(jobs)
    .set({
      done: sql`${jobs.done} + ${delta.done ?? 0}`,
      ok: sql`${jobs.ok} + ${delta.ok ?? 0}`,
      failed: sql`${jobs.failed} + ${delta.failed ?? 0}`,
      spentUsd: sql`${jobs.spentUsd} + ${delta.spentUsd ?? 0}`,
    })
    .where(eq(jobs.id, id))
    .run();
}

export function addJobItem(jobId: number, input: { email: string | null; stage: string; error?: string | null }): JobItem {
  const row = db()
    .insert(jobItems)
    .values({
      jobId,
      email: input.email,
      stage: input.stage,
      error: input.error ?? null,
      updatedAt: Date.now(),
    })
    .returning()
    .get();
  return toItem(row);
}

export function updateJobItem(
  id: number,
  patch: Partial<{ stage: string; attempts: number; error: string | null; accountId: number | null; email: string | null }>,
): void {
  db()
    .update(jobItems)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(jobItems.id, id))
    .run();
}

export function listJobItems(jobId: number, limit = 500): JobItem[] {
  return db()
    .select()
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))
    .orderBy(asc(jobItems.id))
    .limit(limit)
    .all()
    .map(toItem);
}

export function pendingJobItems(jobId: number): JobItem[] {
  return db()
    .select()
    .from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), inArray(jobItems.stage, ['queued', 'purchased'])))
    .orderBy(asc(jobItems.id))
    .all()
    .map(toItem);
}

export function isJobCancelled(jobId: number): boolean {
  const row = db().select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
  return row?.status === 'cancelled';
}

export function cancelJob(id: number): boolean {
  const result = db()
    .update(jobs)
    .set({ status: 'cancelled', finishedAt: Date.now() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
    .run();
  return result.changes === 1;
}

export function failStaleJobs(reason: string): number {
  const result = db()
    .update(jobs)
    .set({ status: 'failed', error: reason, finishedAt: Date.now() })
    .where(inArray(jobs.status, ['queued', 'running']))
    .run();
  return result.changes;
}

export function purgeJobs(days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  return db().delete(jobs).where(lt(jobs.createdAt, cutoff)).run().changes;
}

export function activeJobOfType(type: JobType): Job | null {
  const row = db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ['queued', 'running'])))
    .orderBy(desc(jobs.id))
    .get();
  return row ? toJob(row) : null;
}