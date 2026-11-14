import 'server-only';
import { BmClient, bmConfigFromSettings } from '@/src/adapters/bm/client';
import { getSetting } from '@/src/adapters/db/repositories/settings';
import { globalState } from '@/src/lib/global-state';
import { logger } from '@/src/lib/logger';

const WALLET_TTL_MS = 60_000;

export type WalletSnapshot = { at: number; walletUsd: number | null; configured: boolean; error: string | null };

function cache(): { value: WalletSnapshot } {
  return globalState('bm-wallet', () => ({
    value: { at: 0, walletUsd: null, configured: false, error: null },
  }));
}

/** `/wallet/balance` is a network call; the dashboard polls, so cache for 60 s. */
export async function walletSnapshot(): Promise<WalletSnapshot> {
  const config = bmConfigFromSettings(getSetting);
  if (!config) return { at: Date.now(), walletUsd: null, configured: false, error: null };
  const current = cache().value;
  if (current.at > 0 && current.configured && Date.now() - current.at < WALLET_TTL_MS) return current;
  try {
    const wallet = await new BmClient(config).wallet();
    cache().value = { at: Date.now(), walletUsd: wallet.balance, configured: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache().value = { at: Date.now(), walletUsd: current.walletUsd, configured: true, error: message };
    logger.warn('bm', `wallet snapshot failed: ${message}`);
  }
  return cache().value;
}

export function resetWalletCache(): void {
  cache().value = { at: 0, walletUsd: null, configured: false, error: null };
}