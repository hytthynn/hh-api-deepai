import { z } from 'zod';
import {
  clearSessionCookie,
  clientIp,
  loginAllowed,
  noteLoginFailure,
  resetLoginAttempts,
  sessionCookie,
  signSession,
  verifyAdminPassword,
} from '@/src/server/auth';
import { ApiError, api, jsonBody, readJson } from '@/src/server/api';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ password: z.string().min(1, 'Введите пароль').max(200) });

export const POST = api(
  async (request) => {
    const ip = clientIp(request);
    if (!loginAllowed(ip)) {
      throw new ApiError('rate_limit_exceeded', 429, 'Слишком много попыток входа. Повторите через 10 минут.');
    }
    const { password } = await readJson(request, bodySchema);
    if (!verifyAdminPassword(password)) {
      noteLoginFailure(ip);
      logger.warn('ui', 'failed admin login', { meta: { ip } });
      throw new ApiError('invalid_password', 401, 'Неверный пароль');
    }
    resetLoginAttempts();
    logger.info('ui', 'admin login', { meta: { ip } });
    return jsonBody({ authenticated: true }, 200, { 'set-cookie': sessionCookie(signSession()) });
  },
  { public: true, mutation: true },
);

export const DELETE = api(
  async () => jsonBody({ authenticated: false }, 200, { 'set-cookie': clearSessionCookie() }),
  { public: true, mutation: true },
);