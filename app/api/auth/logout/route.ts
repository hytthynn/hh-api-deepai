import { clearSessionCookie } from '@/src/server/auth';
import { api, jsonBody } from '@/src/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(
  async () => jsonBody({ authenticated: false }, 200, { 'set-cookie': clearSessionCookie() }),
  { mutation: true },
);