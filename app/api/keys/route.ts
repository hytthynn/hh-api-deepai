import { z } from 'zod';
import { api, jsonBody, readJson } from '@/src/server/api';
import { createKey, listKeys } from '@/src/adapters/db/repositories/keys';
import { encrypt, generateApiKey, hashApiKey } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import type { ApiKey } from '@/src/core/entities/api-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SPEC §11 + ADR-021: the plaintext key is encrypted at rest and can be revealed later. */
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

export const GET = api(async () => jsonBody({ keys: listKeys().map(publicKey) }));

const createSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(60),
  tokenLimit: z.number().int().min(1).max(100_000_000).nullable().optional(),
});

export const POST = api(
  async (request) => {
    const input = await readJson(request, createSchema);
    const plaintext = generateApiKey();
    const record = createKey({
      name: input.name,
      prefix: plaintext.slice(0, 12),
      last4: plaintext.slice(-4),
      keyHash: hashApiKey(plaintext),
      keyEnc: encrypt(plaintext),
      tokenLimit: input.tokenLimit ?? null,
    });
    logger.info('ui', `api key created: ${record.name}`, { meta: { key_id: record.id } });
    return jsonBody({ key: plaintext, record: publicKey(record) }, 201);
  },
  { mutation: true },
);