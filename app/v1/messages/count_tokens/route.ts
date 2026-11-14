import { handleAnthropicCountTokens } from '@/src/server/gateway/handlers-anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleAnthropicCountTokens(request);
}