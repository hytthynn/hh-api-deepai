import { handleResponseCancel } from '@/src/server/gateway/handlers-responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** OpenAI Responses API: `POST /v1/responses/:id/cancel`. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return handleResponseCancel(request, id);
}