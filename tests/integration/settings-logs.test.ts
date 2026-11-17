import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { clearSettings, getSetting } from '@/src/adapters/db/repositories/settings';
import { flushLogs, insertLog, purgeLogs, queryLogs } from '@/src/adapters/db/repositories/logs';
import { insertRequest, purgeRequests, queryRequests } from '@/src/adapters/db/repositories/requests';
import { signSession, SESSION_COOKIE } from '@/src/server/auth';
import { DELETE as clearLogs } from '@/app/api/logs/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route';

const DAY = 86_400_000;

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:3210${path}`, {
    ...init,
    headers: {
      cookie: `${SESSION_COOKIE}=${signSession()}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function log(message: string, ts = Date.now()): void {
  insertLog({ ts, level: 'info', scope: 'system', message });
}

function request(id: string, ts = Date.now()): void {
  insertRequest({
    ts,
    requestId: id,
    apiKeyId: null,
    endpoint: 'chat',
    model: 'glm-5.3-flash',
    stream: false,
    accountId: null,
    attempts: 1,
    httpStatus: 200,
    latencyMs: 10,
    firstByteMs: 5,
    inputTokens: 1,
    outputTokens: 1,
    theosBefore: null,
    theosAfter: null,
    errorCode: null,
    client: 'test',
    detail: null,
  });
}

beforeAll(() => {
  runMigrations();
});

afterAll(() => {
  closeDb();
});

beforeEach(() => {
  clearSettings();
});

describe('clear logs', () => {
  it('wipes old and fresh rows of both journals when days is 0', () => {
    log('fresh', Date.now());
    log('stale', Date.now() - 400 * DAY);
    flushLogs();
    request('req_fresh');
    request('req_stale', Date.now() - 400 * DAY);

    expect(purgeLogs(30)).toBe(1);
    expect(queryLogs().length).toBe(1);
    expect(purgeLogs(0)).toBe(1);
    expect(queryLogs().length).toBe(0);
    expect(purgeRequests(0)).toBe(2);
    expect(queryRequests({ per: 100 }).rows.length).toBe(0);
  });

  it('DELETE /api/logs empties the request journal shown on «Логи» as well', async () => {
    log('kept');
    flushLogs();
    request('req_1');
    request('req_2');

    const response = await clearLogs(authed('/api/logs', { method: 'DELETE' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; deleted_requests: number };
    expect(body.deleted_requests).toBe(2);
    expect(queryRequests({ per: 100 }).rows.length).toBe(0);
    expect(queryLogs().length).toBe(0);
  });
});

describe('settings PUT', () => {
  it('saves the runtime knobs exposed in one form and reads them back', async () => {
    const response = await putSettings(
      authed('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          'retention.logs_days': 3,
          'retention.requests_days': 6,
          'gateway.upstream_timeout_ms': 120_000,
          'gateway.slot_wait_ms': 5_000,
          'gateway.rpm_limit': 30,
        }),
      }),
    );
    expect(response.status).toBe(200);

    expect(getSetting('retention.logs_days')).toBe('3');
    expect(getSetting('retention.requests_days')).toBe('6');
    expect(getSetting('gateway.upstream_timeout_ms')).toBe('120000');
    expect(getSetting('gateway.slot_wait_ms')).toBe('5000');
    expect(getSetting('gateway.rpm_limit')).toBe('30');

    const read = await getSettings(authed('/api/settings'));
    const body = (await read.json()) as { values: Record<string, string | null> };
    expect(body.values['retention.logs_days']).toBe('3');
    expect(body.values['gateway.upstream_timeout_ms']).toBe('120000');
  });

  it('accepts old clients that still send a proxy and ignores it', async () => {
    const response = await putSettings(
      authed('/api/settings', { method: 'PUT', body: JSON.stringify({ 'engine.proxy': 'http://proxy:8080' }) }),
    );
    expect(response.status).toBe(200);
    expect(getSetting('engine.proxy')).toBeNull();
  });
});
