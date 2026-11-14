import { api } from '@/src/server/api';
import { listForBalanceSync } from '@/src/adapters/db/repositories/accounts';
import { decrypt } from '@/src/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Settings → Данные → «Экспорт аккаунтов»: `email|password`, one per line. */
export const GET = api(async () => {
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
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="hh-accounts-${stamp}.txt"`,
      'cache-control': 'no-store',
    },
  });
});