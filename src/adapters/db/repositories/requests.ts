import 'server-only';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { RequestRecord } from '@/src/core/entities/request-log';
import { db } from '../client';
import { accounts, requests } from '../schema';

export function insertRequest(record: RequestRecord): void {
  db()
    .insert(requests)
    .values({
      ts: record.ts,
      requestId: record.requestId,
      apiKeyId: record.apiKeyId,
      endpoint: record.endpoint,
      model: record.model,
      stream: record.stream ? 1 : 0,
      accountId: record.accountId,
      attempts: record.attempts,
      httpStatus: record.httpStatus,
      latencyMs: record.latencyMs,
      firstByteMs: record.firstByteMs,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      theosBefore: record.theosBefore,
      theosAfter: record.theosAfter,
      errorCode: record.errorCode,
      client: record.client,
      detail: record.detail,
    })
    .run();
}

export type RequestFilter = {
  model?: string;
  status?: string;
  from?: number;
  to?: number;
  page?: number;
  per?: number;
};

export function queryRequests(filter: RequestFilter = {}) {
  const per = Math.min(200, Math.max(1, filter.per ?? 50));
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.model) conditions.push(eq(requests.model, filter.model));
  if (filter.from) conditions.push(gte(requests.ts, filter.from));
  if (filter.to) conditions.push(lte(requests.ts, filter.to));
  if (filter.status === 'error') conditions.push(sql`(${requests.httpStatus} >= 400 OR ${requests.errorCode} IS NOT NULL)`);
  if (filter.status === 'ok') conditions.push(sql`${requests.httpStatus} < 400`);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = db()
    .select()
    .from(requests)
    .where(where)
    .orderBy(desc(requests.id))
    .limit(per)
    .offset((page - 1) * per)
    .all();
  const total = db().select({ count: sql<number>`count(*)` }).from(requests).where(where).get()?.count ?? 0;
  return { rows, total, page, per };
}

export type StatsRange = '24h' | '7d' | '30d';

const RANGE_MS: Record<StatsRange, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export const BUCKETS: Record<StatsRange, number> = { '24h': 24, '7d': 7, '30d': 30 };

export type StatsPayload = {
  range: StatsRange;
  totals: {
    requests: number;
    errors: number;
    error_rate: number;
    streams: number;
    input_tokens: number;
    output_tokens: number;
    theos_spent: number;
  };
  latency: { p50: number; p95: number; p99: number };
  series: Array<{ t: number; requests: number; errors: number; tokens: number }>;
  by_model: Array<{ model: string; requests: number; errors: number; p95: number }>;
  by_account: Array<{ email: string; requests: number; errors: number; balance: number }>;
  top_errors: Array<{ code: string; count: number }>;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function mask(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return `${email[0] ?? '*'}***@${domain[0] ?? '*'}***${dot === -1 ? '' : domain.slice(dot)}`;
}

export function computeStats(range: StatsRange, now = Date.now()): StatsPayload {
  const from = now - RANGE_MS[range];
  const bucketMs = RANGE_MS[range] / BUCKETS[range];
  const rows = db()
    .select({
      ts: requests.ts,
      model: requests.model,
      accountId: requests.accountId,
      stream: requests.stream,
      latencyMs: requests.latencyMs,
      inputTokens: requests.inputTokens,
      outputTokens: requests.outputTokens,
      httpStatus: requests.httpStatus,
      errorCode: requests.errorCode,
    })
    .from(requests)
    .where(gte(requests.ts, from))
    .all();

  let errors = 0;
  let streams = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const latencies: number[] = [];
  const byModel = new Map<string, { requests: number; errors: number; latencies: number[] }>();
  const byAccount = new Map<number, { requests: number; errors: number }>();
  const errorCounts = new Map<string, number>();

  const series = Array.from({ length: BUCKETS[range] }, (_, i) => ({
    t: Math.floor((from + i * bucketMs) / bucketMs) * bucketMs,
    requests: 0,
    errors: 0,
    tokens: 0,
  }));

  for (const row of rows) {
    const isError = (row.httpStatus ?? 0) >= 400 || row.errorCode !== null;
    if (isError) errors += 1;
    if (row.stream === 1) streams += 1;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    if (!isError && row.latencyMs !== null) latencies.push(row.latencyMs);

    const bucketIndex = Math.min(series.length - 1, Math.max(0, Math.floor((row.ts - from) / bucketMs)));
    const bucket = series[bucketIndex];
    if (bucket) {
      bucket.requests += 1;
      if (isError) bucket.errors += 1;
      bucket.tokens += row.inputTokens + row.outputTokens;
    }

    const modelKey = row.model ?? 'unknown';
    const modelEntry = byModel.get(modelKey) ?? { requests: 0, errors: 0, latencies: [] };
    modelEntry.requests += 1;
    if (isError) modelEntry.errors += 1;
    else if (row.latencyMs !== null) modelEntry.latencies.push(row.latencyMs);
    byModel.set(modelKey, modelEntry);

    if (row.accountId !== null) {
      const accountEntry = byAccount.get(row.accountId) ?? { requests: 0, errors: 0 };
      accountEntry.requests += 1;
      if (isError) accountEntry.errors += 1;
      byAccount.set(row.accountId, accountEntry);
    }

    if (row.errorCode) errorCounts.set(row.errorCode, (errorCounts.get(row.errorCode) ?? 0) + 1);
  }

  const accountRows = db()
    .select({ id: accounts.id, email: accounts.email, balance: accounts.balance })
    .from(accounts)
    .all();
  const accountInfo = new Map(accountRows.map((row) => [row.id, row]));

  const theosRow = db()
    .get<{ spent: number | null }>(
      sql`SELECT COALESCE(SUM(max(0, prev_balance - balance)), 0) AS spent FROM (
            SELECT balance,
                   lag(balance) OVER (PARTITION BY account_id ORDER BY ts) AS prev_balance
            FROM balance_samples WHERE ts >= ${from}
          ) WHERE prev_balance IS NOT NULL`,
    ) ?? { spent: 0 };

  const total = rows.length;
  return {
    range,
    totals: {
      requests: total,
      errors,
      error_rate: total === 0 ? 0 : Number((errors / total).toFixed(4)),
      streams,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      theos_spent: Number((theosRow.spent ?? 0).toFixed(4)),
    },
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    series,
    by_model: [...byModel.entries()]
      .map(([model, entry]) => ({
        model,
        requests: entry.requests,
        errors: entry.errors,
        p95: percentile(entry.latencies, 95),
      }))
      .sort((a, b) => b.requests - a.requests),
    by_account: [...byAccount.entries()]
      .map(([id, entry]) => ({
        email: mask(accountInfo.get(id)?.email ?? 'unknown'),
        requests: entry.requests,
        errors: entry.errors,
        balance: Number((accountInfo.get(id)?.balance ?? 0).toFixed(4)),
      }))
      .sort((a, b) => b.requests - a.requests),
    top_errors: [...errorCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function todaySummary(now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const stats = computeStats('24h', now);
  const todayRows = db()
    .select({
      count: sql<number>`count(*)`,
      errors: sql<number>`sum(CASE WHEN COALESCE(${requests.httpStatus}, 0) >= 400 OR ${requests.errorCode} IS NOT NULL THEN 1 ELSE 0 END)`,
      input: sql<number>`COALESCE(SUM(${requests.inputTokens}), 0)`,
      output: sql<number>`COALESCE(SUM(${requests.outputTokens}), 0)`,
    })
    .from(requests)
    .where(gte(requests.ts, start.getTime()))
    .get();
  return {
    requests: todayRows?.count ?? 0,
    errors: todayRows?.errors ?? 0,
    error_rate: (todayRows?.count ?? 0) === 0 ? 0 : Number(((todayRows?.errors ?? 0) / (todayRows?.count ?? 1)).toFixed(4)),
    p95_ms: stats.latency.p95,
    input_tokens: todayRows?.input ?? 0,
    output_tokens: todayRows?.output ?? 0,
    theos_spent: stats.totals.theos_spent,
  };
}

export function purgeRequests(days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  return db().delete(requests).where(lte(requests.ts, cutoff)).run().changes;
}