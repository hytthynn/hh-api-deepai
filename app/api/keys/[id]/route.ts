import { api, ApiError, jsonBody, parseId } from '@/src/server/api';
import { deleteKey, getKey } from '@/src/adapters/db/repositories/keys';
import { decrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import type { ApiKey } from '@/src/core/entities/api-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicKey(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last4: key.last4,
    token_limit: key.tokenLimit,
    created_at: key.createdAt,
    last_used_at: key.lastUsedAt,
  };
}

/** ADR-021: reveal the stored plaintext for the Keys screen. */
export const GET = api<{ id: string }>(async (_request, params) => {
  const id = parseId(params.id);
  const key = getKey(id);
  if (!key) throw new ApiError('not_found', 404, `Ключ ${id} не найден`);
  if (!key.keyEnc) {
    throw new ApiError(
      'key_not_revealable',
      409,
      'Ключ создан до включения просмотра: сохраните его заново или удалите и создайте новый.',
    );
  }
  let plaintext: string;
  try {
    plaintext = decrypt(key.keyEnc);
  } catch {
    throw new ApiError('key_not_revealable', 409, 'Не удалось расшифровать ключ: сменился HH_SECRET.');
  }
  return jsonBody({
    key: plaintext,
    record: publicKey(key),
  });
});

export const DELETE = api<{ id: string }>(
  async (_request, params) => {
    const id = parseId(params.id);
    const key = getKey(id);
    if (!key) throw new ApiError('not_found', 404, `Ключ ${id} не найден`);
    const deleted = deleteKey(id);
    if (deleted) logger.info('ui', `api key deleted: ${key.name}`, { meta: { key_id: id } });
    return jsonBody({ deleted, id });
  },
  { mutation: true },
);