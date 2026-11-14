import { api, ApiError, jsonBody, parseId } from '@/src/server/api';
import { getKey, revokeKey } from '@/src/adapters/db/repositories/keys';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const DELETE = api<{ id: string }>(
  async (_request, params) => {
    const id = parseId(params.id);
    const key = getKey(id);
    if (!key) throw new ApiError('not_found', 404, `Ключ ${id} не найден`);
    const revoked = revokeKey(id);
    if (revoked) logger.info('ui', `api key revoked: ${key.name}`, { meta: { key_id: id } });
    return jsonBody({ revoked, id });
  },
  { mutation: true },
);