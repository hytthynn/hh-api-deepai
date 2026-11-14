import { api, ApiError, jsonBody, parseId } from '@/src/server/api';
import { cancelJob, getJob } from '@/src/adapters/db/repositories/jobs';
import { isRunning, requestCancel } from '@/src/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const POST = api<{ id: string }>(
  async (_request, params) => {
    const id = parseId(params.id);
    const job = getJob(id);
    if (!job) throw new ApiError('not_found', 404, `Задача ${id} не найдена`);
    if (job.status !== 'queued' && job.status !== 'running') {
      return jsonBody({ job, cancelled: false });
    }
    requestCancel(id);
    if (!isRunning(id)) cancelJob(id);
    const fresh = getJob(id);
    return jsonBody({ job: fresh, cancelled: true });
  },
  { mutation: true },
);