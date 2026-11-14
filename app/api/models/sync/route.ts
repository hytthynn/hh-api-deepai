import { api, jsonBody } from '@/src/server/api';
import { activeJobOfType } from '@/src/adapters/db/repositories/jobs';
import { createModelsSyncJob, runModelsSyncJob } from '@/src/jobs/models-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(
  async () => {
    const active = activeJobOfType('models_sync');
    if (active) return jsonBody({ jobId: active.id, reused: true });
    const job = createModelsSyncJob();
    void runModelsSyncJob(job.id).catch(() => undefined);
    return jsonBody({ jobId: job.id }, 202);
  },
  { mutation: true },
);