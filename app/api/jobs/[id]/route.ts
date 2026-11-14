import { api, ApiError, jsonBody, parseId } from '@/src/server/api';
import { getJob, listJobItems } from '@/src/adapters/db/repositories/jobs';
import { isRunning } from '@/src/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = api<{ id: string }>(async (_request, params) => {
  const id = parseId(params.id);
  const job = getJob(id);
  if (!job) throw new ApiError('not_found', 404, `Задача ${id} не найдена`);
  return jsonBody({ job, items: listJobItems(id), running: isRunning(id) });
});