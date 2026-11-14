import { api, jsonBody } from '@/src/server/api';
import { hasAdminPassword } from '@/src/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async () => jsonBody({ authenticated: true, password_set: hasAdminPassword() }));