import { z } from 'zod';
import { api, ApiError, jsonBody, readJson, intParam, strParam } from '@/src/server/api';
import {
  createAccount,
  getAccountByEmail,
  listAccounts,
  toPublicAccount,
} from '@/src/adapters/db/repositories/accounts';
import { encrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'active', 'cooldown', 'exhausted', 'dead', 'disabled', 'all'] as const;

export const GET = api(async (request) => {
  const url = new URL(request.url);
  const statusRaw = strParam(url.searchParams, 'status') ?? 'all';
  const status = (STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : 'all';
  const page = Math.max(1, intParam(url.searchParams, 'page') ?? 1);
  const per = Math.min(200, Math.max(1, intParam(url.searchParams, 'per') ?? 50));
  const q = strParam(url.searchParams, 'q');
  const { rows, total } = listAccounts({ status, q, page, per });
  return jsonBody({ rows: rows.map(toPublicAccount), total, page, per });
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен').max(200),
  notes: z.string().max(500).optional(),
});

export const POST = api(
  async (request) => {
    const input = await readJson(request, createSchema);
    if (getAccountByEmail(input.email)) {
      throw new ApiError('account_exists', 409, `Аккаунт ${input.email} уже добавлен`);
    }
    const account = createAccount({
      email: input.email,
      passwordEnc: encrypt(input.password),
      cookiesEnc: null,
      machine: null,
      status: 'pending',
      source: 'manual',
      notes: input.notes ?? null,
    });
    logger.info('accounts', `manual account added: ${input.email}`, { accountId: account.id });
    return jsonBody({ account: toPublicAccount(account) }, 201);
  },
  { mutation: true },
);