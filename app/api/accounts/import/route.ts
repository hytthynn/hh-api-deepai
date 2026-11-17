import { z } from 'zod';
import { api, ApiError, jsonBody, readJson } from '@/src/server/api';
import { activeJobOfType } from '@/src/adapters/db/repositories/jobs';
import { transferSchema } from '@/src/core/accounts/transfer';
import { enginePreflightError } from '@/src/jobs/auth';
import { importAccounts, runLoginJob } from '@/src/jobs/login';
import { env } from '@/src/lib/config';
import { logger } from '@/src/lib/logger';
import { importTransfer } from '@/src/server/transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const importSchema = z.union([
  z.object({ text: z.string().min(1, 'Вставьте список логинов').max(500_000) }),
  z.object({ transfer: transferSchema }),
]);

/**
 * SPEC §17.4: bulk import of ready `email|password` lists — each created account is
 * immediately authenticated by a `login` job. SPEC §17.5: `{transfer}` imports a
 * transfer file with cookies, no engine needed (works in gateway mode too).
 */
export const POST = api(
  async (request) => {
    const input = await readJson(request, importSchema);

    if ('transfer' in input) {
      const result = importTransfer(input.transfer);
      return jsonBody(result);
    }

    if (env.mode === 'gateway') {
      throw new ApiError(
        'engine_disabled',
        400,
        'Режим gateway: регистрация недоступна. Импортируйте файл переноса (экспорт с локального экземпляра).',
      );
    }
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