import { api, jsonBody } from '@/src/server/api';
import { engineHealth, engineSettings } from '@/src/server/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MS = 60_000;

type Probe = { at: number; health: Awaited<ReturnType<typeof engineHealth>> };
let cache: Probe | null = null;

export const GET = api(async (request) => {
  const url = new URL(request.url);
  const refresh = url.searchParams.get('refresh') === '1';
  if (refresh || !cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), health: await engineHealth() };
  }
  return jsonBody({
    health: cache.health,
    chrome_ok: cache.health?.chrome_ok ?? false,
    settings: engineSettings(),
  });
});