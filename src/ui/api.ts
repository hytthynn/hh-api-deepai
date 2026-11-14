export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function toError(response: Response): Promise<ApiClientError> {
  let code = `http_${response.status}`;
  let message = `Ошибка ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    if (payload.error?.code) code = payload.error.code;
    if (payload.error?.message) message = payload.error.message;
  } catch {
    // non-JSON body
  }
  return new ApiClientError(response.status, code, message);
}

function handleUnauthorized(error: ApiClientError): void {
  if (error.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    // Модуль вне React — router недоступен; полная перезагрузка сбрасывает кеши useApi.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) {
    const error = await toError(response);
    handleUnauthorized(error);
    throw error;
  }
  return (await response.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = await toError(response);
    handleUnauthorized(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}