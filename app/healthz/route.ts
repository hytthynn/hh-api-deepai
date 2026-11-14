import { ensureBooted, runtimeState } from '@/src/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness probe used by the sidebar indicator every 15 s (SPEC §21). */
export async function GET(): Promise<Response> {
  const state: ReturnType<typeof runtimeState> = ensureBooted();
  const ok = state.ready && !state.locked && state.error === null;
  return new Response(
    JSON.stringify({
      status: ok ? 'ok' : 'degraded',
      ready: state.ready,
      locked: state.locked,
      error: state.error,
      uptime_sec: Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)),
    }),
    {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}