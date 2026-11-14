import { api, ApiError, jsonBody, parseId } from '@/src/server/api';
import { getAccount, toPublicAccount } from '@/src/adapters/db/repositories/accounts';
import { probeAccount } from '@/src/jobs/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const POST = api<{ id: string }>(
  async (_request, params) => {
    const id = parseId(params.id);
    const account = getAccount(id);
    if (!account) throw new ApiError('not_found', 404, `Аккаунт ${id} не найден`);
    const outcome = await probeAccount(account, { chat: true });
    const fresh = getAccount(id);
    return jsonBody({
      ok: outcome.ok,
      reason: outcome.reason,
      balance: outcome.balance,
      granted: outcome.granted,
      refresh_at: outcome.refreshAt,
      account: fresh ? toPublicAccount(fresh) : null,
    });
  },
  { mutation: true },
);