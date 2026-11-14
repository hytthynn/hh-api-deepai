import { api, jsonBody } from '@/src/server/api';
import { countByStatus, totalBalance } from '@/src/adapters/db/repositories/accounts';
import { recentErrors } from '@/src/adapters/db/repositories/logs';
import { todaySummary } from '@/src/adapters/db/repositories/requests';
import { modelsSyncDue } from '@/src/jobs/models-sync';
import { runtimeState } from '@/src/server/runtime';
import { walletSnapshot } from '@/src/server/bm-wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const counts = countByStatus();
  const status = (key: string): number => counts[key] ?? 0;
  const wallet = await walletSnapshot();
  const state = runtimeState();
  return jsonBody({
    accounts: {
      total:
        status('pending') +
        status('active') +
        status('cooldown') +
        status('exhausted') +
        status('dead') +
        status('disabled'),
      active: status('active'),
      cooldown: status('cooldown'),
      exhausted: status('exhausted'),
      dead: status('dead'),
      pending: status('pending'),
      disabled: status('disabled'),
    },
    balance_theos: Number(totalBalance().toFixed(4)),
    bm: {
      configured: wallet.configured,
      wallet_usd: wallet.walletUsd,
      error: wallet.error,
    },
    today: todaySummary(),
    recent_errors: recentErrors(5).map((row) => ({
      ts: row.ts,
      scope: row.scope,
      message: row.message,
      request_id: row.requestId ?? null,
    })),
    runtime: {
      warnings: state.buildWarnings,
      locked: state.locked,
      started_at: state.startedAt,
      models_sync_due: modelsSyncDue(),
    },
  });
});