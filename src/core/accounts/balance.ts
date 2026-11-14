export type TheosSnapshot = {
  enabled: boolean;
  balance: number;
  granted: number;
  refreshAt: string | null;
  laneVersion: number | null;
};

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function parseTheos(body: unknown): TheosSnapshot {
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const lane = typeof data.lane_version === 'number' ? data.lane_version : Number(data.lane_version);
  return {
    enabled: data.enabled === true,
    balance: toNumber(data.balance),
    granted: toNumber(data.granted),
    refreshAt: toIso(data.refresh_at),
    laneVersion: Number.isFinite(lane) && lane > 0 ? Math.trunc(lane) : null,
  };
}

export type BalanceSample = { ts: number; balance: number };

/**
 * SPEC §16.5: spent = Σ max(0, prev − cur). A balance increase is a refresh, not
 * a negative spend, so it contributes 0.
 */
export function spentBetween(samples: BalanceSample[]): number {
  const ordered = [...samples].sort((a, b) => a.ts - b.ts);
  let spent = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) continue;
    spent += Math.max(0, previous.balance - current.balance);
  }
  return Number(spent.toFixed(5));
}

export function refreshDue(refreshAt: string | null, now = Date.now()): boolean {
  if (!refreshAt) return false;
  const ts = Date.parse(refreshAt);
  return !Number.isNaN(ts) && ts + 60_000 <= now;
}