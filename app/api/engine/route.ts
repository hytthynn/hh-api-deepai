import { api, jsonBody } from '@/src/server/api';
import { env } from '@/src/lib/config';
import { engineHealth, engineSettings } from '@/src/server/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MS = 60_000;

type Probe = { at: number; health: Awaited<ReturnType<typeof engineHealth>> };
let cache: Probe | null = null;

export const GET = api(async (request) => {
  // ADR-025: gateway mode has no Python worker — never spawn a probe there.
  if (env.mode === 'gateway') {
    return jsonBody({ mode: env.mode, health: null, chrome_ok: false, settings: engineSettings() });
  }
  const url = new URL(request.url);
  const refresh = url.searchParams.get('refresh') === '1';
  if (refresh || !cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), health: await engineHealth() };
  }
  return jsonBody({
    mode: env.mode,
    health: cache.health,
    chrome_ok: cache.health?.chrome_ok ?? false,
    settings: engineSettings(),
  });
});