import { globalState } from './global-state';
import { redactJson } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogScope = 'gateway' | 'engine' | 'bm' | 'accounts' | 'jobs' | 'ui' | 'system';

export type LogEntry = {
  ts: number;
  level: LogLevel;
  scope: LogScope;
  message: string;
  accountId?: number | null;
  requestId?: string | null;
  meta?: string | null;
};

type Sink = (entry: LogEntry) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

type LoggerState = { sink: Sink | null; minLevel: LogLevel; pending: LogEntry[] };

const MAX_PENDING = 500;

function state(): LoggerState {
  return globalState<LoggerState>('logger', () => ({ sink: null, minLevel: 'info', pending: [] }));
}

export function attachLogSink(fn: Sink): void {
  const current = state();
  current.sink = fn;
  while (current.pending.length > 0) {
    const entry = current.pending.shift();
    if (!entry) break;
    safeWrite(fn, entry);
  }
}

export function setLogLevel(level: LogLevel): void {
  state().minLevel = level;
}

export function getLogLevel(): LogLevel {
  return state().minLevel;
}

function safeWrite(fn: Sink, entry: LogEntry): void {
  try {
    fn(entry);
  } catch {
    // logging must never break the request path
  }
}

function writeStdout(entry: LogEntry): void {
  const payload: Record<string, unknown> = {
    ts: new Date(entry.ts).toISOString(),
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
  };
  if (entry.accountId) payload.account_id = entry.accountId;
  if (entry.requestId) payload.request_id = entry.requestId;
  if (entry.meta) payload.meta = entry.meta;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export type LogMeta = Record<string, unknown>;

export function log(
  level: LogLevel,
  scope: LogScope,
  message: string,
  options: { accountId?: number | null; requestId?: string | null; meta?: LogMeta } = {},
): void {
  const current = state();
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[current.minLevel]) return;
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    scope,
    message,
    accountId: options.accountId ?? null,
    requestId: options.requestId ?? null,
    meta: options.meta ? redactJson(options.meta, 2048) : null,
  };
  writeStdout(entry);
  if (current.sink) safeWrite(current.sink, entry);
  else {
    current.pending.push(entry);
    if (current.pending.length > MAX_PENDING) {
      current.pending.splice(0, current.pending.length - MAX_PENDING);
    }
  }
}

export const logger = {
  debug: (scope: LogScope, message: string, options?: Parameters<typeof log>[3]) => log('debug', scope, message, options),
  info: (scope: LogScope, message: string, options?: Parameters<typeof log>[3]) => log('info', scope, message, options),
  warn: (scope: LogScope, message: string, options?: Parameters<typeof log>[3]) => log('warn', scope, message, options),
  error: (scope: LogScope, message: string, options?: Parameters<typeof log>[3]) => log('error', scope, message, options),
};