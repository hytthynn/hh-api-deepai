import 'server-only';
import type { ImportResult } from '@/src/jobs/login';
import {
  createAccount,
  getAccountByEmailCI,
  listForTransfer,
} from '@/src/adapters/db/repositories/accounts';
import { TRANSFER_FORMAT, type Transfer, type TransferAccount } from '@/src/core/accounts/transfer';
import { decrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';

/** SPEC §17.5: ciphertext is exported as-is; the receiving instance needs the same HH_SECRET. */
export function buildTransfer(): Transfer {
  const accounts: TransferAccount[] = [];
  for (const account of listForTransfer()) {
    if (!account.passwordEnc) continue;
    accounts.push({
      email: account.email,
      passwordEnc: account.passwordEnc,
      cookiesEnc: account.cookiesEnc,
      machine: account.machine,
      balance: account.balance,
      granted: account.granted,
      refreshAt: account.refreshAt,
      laneVersion: account.laneVersion,
    });
  }
  return { format: TRANSFER_FORMAT, version: 1, exportedAt: new Date().toISOString(), accounts };
}

/**
 * SPEC §17.5: imported accounts arrive already authenticated (cookies included), so no
 * `login` job is created. Entries that cannot be decrypted (wrong HH_SECRET) are `invalid`.
 */
export function importTransfer(transfer: Transfer): ImportResult {
  const skipped: string[] = [];
  const invalid: string[] = [];
  let created = 0;
  for (const entry of transfer.accounts) {
    const email = entry.email.trim();
    if (getAccountByEmailCI(email)) {
      skipped.push(email);
      continue;
    }
    try {
      decrypt(entry.passwordEnc);
      if (entry.cookiesEnc) decrypt(entry.cookiesEnc);
    } catch {
      invalid.push(email);
      continue;
    }
    createAccount({
      email,
      passwordEnc: entry.passwordEnc,
      cookiesEnc: entry.cookiesEnc ?? null,
      machine: entry.machine ?? null,
      status: 'active',
      source: 'transfer',
      balance: entry.balance ?? 0,
      granted: entry.granted ?? 0,
      refreshAt: entry.refreshAt ?? null,
      laneVersion: entry.laneVersion ?? null,
    });
    created += 1;
  }
  logger.info('ui', `transfer import: created=${created} skipped=${skipped.length} invalid=${invalid.length}`);
  return { jobId: null, created, skipped, invalid, total: transfer.accounts.length };
}