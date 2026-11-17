import { api } from '@/src/server/api';
import { exportDatabase } from '@/src/server/db-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Settings → Данные → «Скачать БД»: full SQLite snapshot (SPEC §17.6, ADR-026). */
export const GET = api(async () => {
  const { bytes, filename } = await exportDatabase();
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});