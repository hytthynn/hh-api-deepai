import { api, ApiError, jsonBody } from '@/src/server/api';
import { createProbeJob, runProbeJob } from '@/src/jobs/probe';
import { activeJobOfType } from '@/src/adapters/db/repositories/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts a background probe of every account with cookies. The UI follows progress via
 * `GET /api/jobs/:id`; the job id is also stored in `jobs` so a restart can report it.
 */
export const POST = api(
  async () => {
    const active = activeJobOfType('probe');
    if (active) return jsonBody({ jobId: active.id, reused: true });
    const job = createProbeJob(null);
    if (job.total === 0) throw new ApiError('no_accounts', 400, 'Нет аккаунтов для проверки');
    void runProbeJob(job.id).catch(() => undefined);
    return jsonBody({ jobId: job.id, total: job.total }, 202);
  },
  { mutation: true },
);