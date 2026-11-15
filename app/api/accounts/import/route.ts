import { z } from 'zod';
import { api, jsonBody, readJson } from '@/src/server/api';
import { parseLogins } from '@/src/adapters/bm/client';
import { createAccount, getAccountByEmailCI } from '@/src/adapters/db/repositories/accounts';
import { encrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const importSchema = z.object({
  text: z.string().min(1, 'Вставьте список логинов').max(500_000),
});

/** SPEC §11: bulk import of ready `email|password` lists. */
export const POST = api(
  async (request) => {
    const input = await readJson(request, importSchema);
    const { parsed, invalid } = parseLogins(input.text.split(/\r?\n/));
    const skipped: string[] = [];
    let created = 0;
    for (const login of parsed) {
      if (getAccountByEmailCI(login.email)) {
        skipped.push(login.email);
        continue;
      }
      try {
        createAccount({
          email: login.email,
          passwordEnc: encrypt(login.password),
          status: 'pending',
          source: 'import',
        });
        created += 1;
      } catch {
        skipped.push(login.email);
      }
    }
    logger.info('accounts', `import: created ${created}, skipped ${skipped.length}, invalid ${invalid.length}`);
    return jsonBody({ created, skipped, invalid, total: parsed.length + invalid.length }, 201);
  },
  { mutation: true },
);