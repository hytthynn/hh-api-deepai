import { api, intParam, jsonBody, strParam } from '@/src/server/api';
import { queryRequests } from '@/src/adapters/db/repositories/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async (request) => {
  const url = new URL(request.url);
  const result = queryRequests({
    model: strParam(url.searchParams, 'model'),
    status: strParam(url.searchParams, 'status'),
    from: intParam(url.searchParams, 'from'),
    to: intParam(url.searchParams, 'to'),
    page: intParam(url.searchParams, 'page') ?? 1,
    per: intParam(url.searchParams, 'per') ?? 50,
  });
  return jsonBody(result);
});