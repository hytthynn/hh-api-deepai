import 'server-only';
import { EnginePool } from '@/src/adapters/engine/pool';
import { getBool, getInt, getSetting } from '@/src/adapters/db/repositories/settings';
import { env } from '@/src/lib/config';
import { globalState } from '@/src/lib/global-state';
import { logger } from '@/src/lib/logger';

const DEFAULT_JOB_TIMEOUT_MS = 180_000;

type PoolState = { pool: EnginePool | null; signature: string };

function poolState(): PoolState {
  return globalState<PoolState>('engine-pool', () => ({ pool: null, signature: '' }));
}

type EngineSettings = {
  workers: number;
  restartAfter: number;
  headless: boolean;
  proxy: string | null;
};

export function engineSettings(): EngineSettings {
  return {
    workers: Math.max(1, Math.min(8, getInt('engine.workers', 2))),
    restartAfter: Math.max(1, getInt('engine.restart_after', 10)),
    headless: getBool('engine.headless', false),
    proxy: getSetting('engine.proxy') || null,
  };
}

/**
 * Settings are read on every call so a change in the UI (workers, proxy, headless)
 * takes effect without a restart; the previous pool is drained in the background.
 */
export function enginePool(): EnginePool {
  const settings = engineSettings();
  const next = JSON.stringify(settings);
  const state = poolState();
  if (state.pool && next === state.signature) return state.pool;
  const previous = state.pool;
  state.pool = new EnginePool({
    python: env.python,
    engineDir: env.engineDir,
    workers: settings.workers,
    restartAfter: settings.restartAfter,
    proxy: settings.proxy,
    headless: settings.headless,
    timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
    onLog: (level, message, meta) => logger[level]('engine', message, { meta }),
  });
  state.signature = next;
  if (previous) {
    logger.info('engine', 'engine pool reconfigured');
    void previous.shutdown().catch(() => undefined);
  }
  return state.pool;
}

export async function engineHealth(): Promise<{ python: string; playwright: string; chrome: string; chrome_ok: boolean } | null> {
  try {
    const hello = await enginePool().health();
    if (!hello) return null;
    return { python: hello.python, playwright: hello.playwright, chrome: hello.chrome, chrome_ok: hello.chrome_ok };
  } catch (error) {
    logger.warn('engine', `engine health failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function shutdownEngine(): Promise<void> {
  const state = poolState();
  const current = state.pool;
  state.pool = null;
  state.signature = '';
  if (!current) return;
  try {
    await current.shutdown();
  } catch (error) {
    logger.warn('engine', `engine shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}