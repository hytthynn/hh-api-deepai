import { api, ApiError, jsonBody } from '@/src/server/api';
import { importDatabase } from '@/src/server/db-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DB_BYTES = 256 * 1024 * 1024;

/**
 * Settings → Данные → «Импорт БД»: replaces the whole database with the uploaded
 * snapshot (SPEC §17.6, ADR-026). Works in both modes; validated before the swap.
 */
export const POST = api(
  async (request) => {
    const raw = await request.arrayBuffer();
    if (raw.byteLength === 0) throw new ApiError('bad_request', 400, 'Пустой файл: выберите снимок БД (.db)');
    if (raw.byteLength > MAX_DB_BYTES) throw new ApiError('too_large', 413, 'Файл больше 256 МБ — это не снимок БД hh-api');
    return jsonBody(importDatabase(Buffer.from(raw)));
  },
  { mutation: true },
);