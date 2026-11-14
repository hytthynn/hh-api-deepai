import { handleModelsList } from '@/src/server/gateway/handlers-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleModelsList(request);
}