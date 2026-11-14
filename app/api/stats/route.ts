import { api, jsonBody, strParam } from '@/src/server/api';
import { computeStats, type StatsRange } from '@/src/adapters/db/repositories/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGES: readonly StatsRange[] = ['24h', '7d', '30d'];

export const GET = api(async (request) => {
  const url = new URL(request.url);
  const raw = strParam(url.searchParams, 'range') ?? '24h';
  const range: StatsRange = (RANGES as readonly string[]).includes(raw) ? (raw as StatsRange) : '24h';
  return jsonBody(computeStats(range));
});