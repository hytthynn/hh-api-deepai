import { api, intParam, jsonBody, strParam } from '@/src/server/api';
import { flushLogs, purgeLogs, queryLogs } from '@/src/adapters/db/repositories/logs';
import { purgeRequests } from '@/src/adapters/db/repositories/requests';
import { logger } from '@/src/lib/logger';

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

/**
 * Settings → Данные → «Очистить логи». The journal shown on «Логи» is `requests`, while
 * `logs` holds diagnostics; the button must empty both, otherwise the table still shows rows.
 */
export const DELETE = api(
  async () => {
    flushLogs();
    const requests = purgeRequests(0);
    const deleted = purgeLogs(0);
    // The entry below is written after the purge on purpose: it proves the log survived the clear.
    logger.info('ui', `logs cleared: ${deleted} log rows, ${requests} request rows`);
    return jsonBody({ deleted, deleted_requests: requests });
  },
  { mutation: true },
);
