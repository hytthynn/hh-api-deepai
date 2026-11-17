import 'server-only';
import { and, desc, eq, like, lt, sql } from 'drizzle-orm';
import type { LogEntry, LogLevel } from '@/src/lib/logger';
import { db } from '../client';
import { logs } from '../schema';

const queue: Array<typeof logs.$inferInsert> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function insertLog(entry: LogEntry): void {
  queue.push({
    ts: entry.ts,
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
    accountId: entry.accountId ?? null,
    requestId: entry.requestId ?? null,
    meta: entry.meta ?? null,
  });
  if (queue.length >= 20) {
    flushLogs();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flushLogs();
    }, 250);
    timer.unref?.();
  }
}

export function flushLogs(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    db().transaction((trx) => {
      for (const row of batch) trx.insert(logs).values(row).run();
    });
  } catch {
    // stdout already contains the entries; dropping the DB copy is acceptable
  }
}

export type LogFilter = {
  level?: string;
  scope?: string;
  accountId?: number;
  q?: string;
  before?: number;
  per?: number;
};

export type LogRow = {
  id: number;
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  accountId: number | null;
  requestId: string | null;
  meta: string | null;
};

export function queryLogs(filter: LogFilter = {}): LogRow[] {
  const per = Math.min(500, Math.max(1, filter.per ?? 100));
  const conditions = [];
  if (filter.level) conditions.push(eq(logs.level, filter.level));
  if (filter.scope) conditions.push(eq(logs.scope, filter.scope));
  if (filter.accountId) conditions.push(eq(logs.accountId, filter.accountId));
  if (filter.before) conditions.push(lt(logs.id, filter.before));
  if (filter.q) {
    const needle = `%${filter.q.trim()}%`;
    conditions.push(sql`(${like(logs.message, needle)} OR ${like(logs.meta, needle)})`);
  }
  const rows = db()
    .select()
    .from(logs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(logs.id))
    .limit(per)
    .all();
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    level: row.level as LogLevel,
    scope: row.scope,
    message: row.message,
    accountId: row.accountId,
    requestId: row.requestId,
    meta: row.meta,
  }));
}

export function recentErrors(limit = 5): LogRow[] {
  return db()
    .select()
    .from(logs)
    .where(eq(logs.level, 'error'))
    .orderBy(desc(logs.ts))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      ts: row.ts,
      level: row.level as LogLevel,
      scope: row.scope,
      message: row.message,
      accountId: row.accountId,
      requestId: row.requestId,
      meta: row.meta,
    }));
}

export function purgeLogs(days: number): number {
  if (days <= 0) return db().delete(logs).run().changes;
  const cutoff = Date.now() - days * 86_400_000;
  const result = db().delete(logs).where(lt(logs.ts, cutoff)).run();
  return result.changes;
}