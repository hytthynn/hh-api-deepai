import { z } from 'zod';
import { api, ApiError, jsonBody, parseId, readJson } from '@/src/server/api';
import {
  deleteAccount,
  getAccount,
  toPublicAccount,
  updateAccount,
} from '@/src/adapters/db/repositories/accounts';
import { reduceAccount } from '@/src/core/accounts/state';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const PATCH = api<{ id: string }>(
  async (request, params) => {
    const id = parseId(params.id);
    const account = getAccount(id);
    if (!account) throw new ApiError('not_found', 404, `Аккаунт ${id} не найден`);
    const body = await readJson(request, z.object({ status: z.enum(['disabled', 'active']) }));
    updateAccount(id, reduceAccount(account, { type: 'manual', status: body.status }));
    const updated = getAccount(id);
    logger.info('accounts', `account ${id} set to ${body.status}`);
    return jsonBody({ account: updated ? toPublicAccount(updated) : null });
  },
  { mutation: true },
);

export const DELETE = api<{ id: string }>(
  async (_request, params) => {
    const id = parseId(params.id);
    const account = getAccount(id);
    if (!account) throw new ApiError('not_found', 404, `Аккаунт ${id} не найден`);
    deleteAccount(id);
    logger.info('accounts', `account ${id} deleted`, { accountId: id });
    return jsonBody({ deleted: true, id });
  },
  { mutation: true },
);