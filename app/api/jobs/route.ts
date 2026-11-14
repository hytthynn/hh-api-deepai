import { z } from 'zod';
import { api, ApiError, jsonBody, readJson } from '@/src/server/api';
import { activeJobOfType, listJobs } from '@/src/adapters/db/repositories/jobs';
import { createProvisionJob, runProvisionJob } from '@/src/jobs/provision';
import { getSetting } from '@/src/adapters/db/repositories/settings';
import { engineHealth } from '@/src/server/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  type: z.literal('provision'),
  quantity: z.number().int().min(1).max(50),
  productId: z.number().int().positive().optional(),
  workers: z.number().int().min(1).max(8).optional(),
  headless: z.boolean().optional(),
  proxy: z.string().max(300).optional(),
  resumeJobId: z.number().int().positive().optional(),
});

export const GET = api(async () => jsonBody({ jobs: listJobs(20) }));

export const POST = api(
  async (request) => {
    const params = await readJson(request, bodySchema);
    if (getSetting('bm.api_key') === null) {
      throw new ApiError('bm_not_configured', 400, 'API-ключ BM не задан. Откройте «Настройки» и сохраните ключ.');
    }
    const active = activeJobOfType('provision');
    if (active) {
      throw new ApiError('job_running', 409, `Уже выполняется закупка #${active.id}. Дождитесь её завершения.`);
    }
    const health = await engineHealth();
    if (!health) {
      throw new ApiError(
        'engine_not_ready',
        400,
        'Python-воркер не отвечает. Проверьте Python и Playwright: npm run doctor.',
      );
    }
    if (!health.chrome_ok) {
      throw new ApiError(
        'engine_not_ready',
        400,
        'Chrome не найден. Выполните python -m playwright install chrome и повторите.',
      );
    }
    const job = createProvisionJob(params);
    void runProvisionJob(job.id).catch(() => undefined);
    return jsonBody({ jobId: job.id }, 202);
  },
  { mutation: true },
);