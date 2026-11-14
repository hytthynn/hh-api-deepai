import {
  handleResponseDelete,
  handleResponseGet,
} from '@/src/server/gateway/handlers-responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return handleResponseGet(request, id);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return handleResponseDelete(request, id);
}