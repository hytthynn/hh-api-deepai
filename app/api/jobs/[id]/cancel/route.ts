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
    // Persist first: the runner may live in another module graph, and a crash between
    // here and `requestCancel` must still leave the job cancelled on restart.
    cancelJob(id);
    if (isRunning(id)) requestCancel(id);
    const fresh = getJob(id);
    return jsonBody({ job: fresh ?? job, cancelled: true });
  },
  { mutation: true },
);