import { handleResponses } from '@/src/server/gateway/handlers-responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleResponses(request);
}