import { api, intParam, jsonBody, strParam } from '@/src/server/api';
import { flushLogs, purgeLogs, queryLogs } from '@/src/adapters/db/repositories/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async (request) => {
  const url = new URL(request.url);
  const rows = queryLogs({
    level: strParam(url.searchParams, 'level'),
    scope: strParam(url.searchParams, 'scope'),
    accountId: intParam(url.searchParams, 'accountId'),
    q: strParam(url.searchParams, 'q'),
    before: intParam(url.searchParams, 'before'),
    per: intParam(url.searchParams, 'per') ?? 100,
  });
  return jsonBody({
    rows,
    next_before: rows.length > 0 ? rows[rows.length - 1]?.id ?? null : null,
  });
});

/** Settings → Данные → «Очистить логи». */
export const DELETE = api(
  async () => {
    flushLogs();
    const deleted = purgeLogs(0);
    return jsonBody({ deleted });
  },
  { mutation: true },
);