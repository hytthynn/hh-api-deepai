export const JOB_STATUSES = ['queued', 'running', 'cancelled', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ['provision', 'probe', 'models_sync'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Job = {
  id: number;
  type: JobType;
  status: JobStatus;
  params: string;
  total: number;
  done: number;
  ok: number;
  failed: number;
  spentUsd: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type JobItem = {
  id: number;
  jobId: number;
  email: string | null;
  stage: string;
  attempts: number;
  error: string | null;
  accountId: number | null;
  updatedAt: number;
};