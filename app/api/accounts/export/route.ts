import { api, jsonBody } from '@/src/server/api';
import { listForBalanceSync } from '@/src/adapters/db/repositories/accounts';
import { buildTransfer } from '@/src/server/transfer';
import { decrypt } from '@/src/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settings → Данные → «Экспорт аккаунтов»: `email|password`, one per line.
 * `?format=transfer` (SPEC §17.5): JSON with ciphertext for moving accounts to a gateway instance.
 */
export const GET = api(async (request) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'transfer') {
    return jsonBody(buildTransfer(), 200, {
      'content-disposition': `attachment; filename="hh-transfer-${stamp}.json"`,
    });
  }
  const lines: string[] = [];
  for (const account of listForBalanceSync()) {
    if (!account.passwordEnc) continue;
    let password = '';
    try {
      password = decrypt(account.passwordEnc);
    } catch {
      continue;
    }
    lines.push(`${account.email}|${password}`);
  }
  return new Response(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="hh-accounts-${stamp}.txt"`,
      'cache-control': 'no-store',
    },
  });
});