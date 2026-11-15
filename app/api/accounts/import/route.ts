import { z } from 'zod';
import { api, ApiError, jsonBody, readJson } from '@/src/server/api';
import { activeJobOfType } from '@/src/adapters/db/repositories/jobs';
import { enginePreflightError } from '@/src/jobs/auth';
import { importAccounts, runLoginJob } from '@/src/jobs/login';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const importSchema = z.object({
  text: z.string().min(1, 'Вставьте список логинов').max(500_000),
});

/**
 * SPEC §17.4: bulk import of ready `email|password` lists. Each created account is
 * immediately authenticated by a `login` job — a `pending` row alone is useless.
 */
export const POST = api(
  async (request) => {
    const input = await readJson(request, importSchema);
    const active = activeJobOfType('login');
    if (active) {
      throw new ApiError('job_running', 409, `Уже выполняется вход в аккаунты #${active.id}. Дождитесь завершения.`);
    }
    const notReady = await enginePreflightError();
    if (notReady) throw new ApiError('engine_not_ready', 400, notReady);

    const result = importAccounts(input.text);
    if (result.jobId !== null) void runLoginJob(result.jobId).catch(() => undefined);
    logger.info(
      'accounts',
      `import: created ${result.created}, skipped ${result.skipped.length}, invalid ${result.invalid.length}, login job ${result.jobId ?? '—'}`,
    );
    return jsonBody(result, 202);
  },
  { mutation: true },
);