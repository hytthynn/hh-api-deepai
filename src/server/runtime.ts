import 'server-only';
import { closeDb } from '@/src/adapters/db/client';
import { getSetting, setSetting } from '@/src/adapters/db/repositories/settings';
import { flushLogs, insertLog } from '@/src/adapters/db/repositories/logs';
import { runMigrations } from '@/src/adapters/db/migrate';
import { acquireLock, lockHolder, type HeldLock } from '@/src/lib/locks';
import { env } from '@/src/lib/config';
import { globalState } from '@/src/lib/global-state';
import { attachLogSink, logger, setLogLevel } from '@/src/lib/logger';
import { startCron, stopCron } from '@/src/jobs/cron';
import { slots } from './slots';
import { shutdownEngine } from './engine';

export type RuntimeState = {
  ready: boolean;
  locked: boolean;
  error: string | null;
  startedAt: number;
  lockPid: number | null;
  buildWarnings: string[];
};

type RuntimeBundle = {
  state: RuntimeState;
  booted: boolean;
  lock: HeldLock | null;
  signalsBound: boolean;
};

/**
 * Next.js loads instrumentation and every route handler as separate module graphs, so
 * a module-level `booted` flag would let each of them boot again (and fight over the
 * instance lock). The bundle lives on `globalThis` instead: exactly one boot per process.
 */
function bundle(): RuntimeBundle {
  return globalState<RuntimeBundle>('runtime', () => ({
    state: {
      ready: false,
      locked: false,
      error: null,
      startedAt: Date.now(),
      lockPid: null,
      buildWarnings: [],
    },
    booted: false,
    lock: null,
    signalsBound: false,
  }));
}

/**
 * ADR-011: the owner's pre-existing BM key lived in `.env`. It is imported once into
 * encrypted `settings.bm.api_key` and then removed from `process.env` so the UI is the
 * single source of truth.
 */
function importLegacyBmKey(): void {
  const legacy = (process.env.BM_KEY ?? process.env.HH_BM_KEY ?? '').trim();
  if (!legacy) return;
  if (getSetting('bm.api_key')) {
    delete process.env.BM_KEY;
    delete process.env.HH_BM_KEY;
    bundle().state.buildWarnings.push('BM_KEY in .env is ignored: settings.bm.api_key already set');
    return;
  }
  setSetting('bm.api_key', legacy, true);
  delete process.env.BM_KEY;
  delete process.env.HH_BM_KEY;
  bundle().state.buildWarnings.push('BM_KEY imported from .env into encrypted settings');
  logger.info('system', 'legacy BM key imported into encrypted settings');
}

export function runtimeState(): RuntimeState {
  return bundle().state;
}

export function runtimeReady(): boolean {
  return bundle().state.ready;
}

function bindSignals(): void {
  const current = bundle();
  if (current.signalsBound) return;
  current.signalsBound = true;
  const handler = (signal: NodeJS.Signals): void => {
    void shutdown(signal);
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}

export async function shutdown(signal: string): Promise<void> {
  const current = bundle();
  logger.info('system', `shutting down (${signal})`);
  stopCron();
  await slots.drain(5_000);
  await shutdownEngine();
  try {
    flushLogs();
  } catch {
    // DB may be unreachable during shutdown
  }
  current.lock?.release();
  current.lock = null;
  closeDb();
  current.state.ready = false;
  process.exit(0);
}

/** Idempotent bootstrap: migrations, seed, lock, cron, legacy import (SPEC §23). */
export function boot(): RuntimeState {
  const current = bundle();
  if (current.booted) return current.state;
  current.booted = true;
  setLogLevel(env.logLevel);
  attachLogSink(insertLog);

  try {
    runMigrations();
  } catch (error) {
    current.state.error = `migrations failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('system', current.state.error);
    return current.state;
  }

  try {
    importLegacyBmKey();
  } catch (error) {
    logger.error('system', `legacy BM key import failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  current.lock = acquireLock('hh-api', 90_000);
  if (!current.lock) {
    const holder = (() => {
      try {
        return lockHolder('hh-api');
      } catch {
        return null;
      }
    })();
    current.state.locked = true;
    current.state.lockPid = holder?.pid ?? null;
    logger.warn('system', `another hh-api instance holds the database lock (pid ${holder?.pid ?? '?'})`);
    return current.state;
  }

  startCron();
  bindSignals();
  current.state.ready = true;
  logger.info('system', 'hh-api started', {
    meta: {
      port: env.port,
      host: env.host,
      db: env.dbPath,
      node: process.version,
      remote: env.allowRemote,
    },
  });
  return current.state;
}

/** Route handlers call this so a cold dev server still has a migrated DB. */
export function ensureBooted(): RuntimeState {
  const current = bundle();
  return current.booted ? current.state : boot();
}