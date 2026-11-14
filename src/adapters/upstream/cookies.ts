import { z } from 'zod';
import type { UpstreamCookie } from '@/src/core/ports/upstream';

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().default('deepai.org'),
});

const cookieListSchema = z.array(cookieSchema);

export function normalizeCookies(raw: unknown): UpstreamCookie[] {
  const parsed = cookieListSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data
    .filter((cookie) => cookie.domain.includes('deepai') || cookie.domain === '')
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || 'deepai.org',
    }));
}

export function serializeCookies(cookies: UpstreamCookie[]): string {
  return JSON.stringify(cookies.map(({ name, value, domain }) => ({ name, value, domain })));
}

export function deserializeCookies(payload: string | null | undefined): UpstreamCookie[] {
  if (!payload) return [];
  try {
    return normalizeCookies(JSON.parse(payload));
  } catch {
    return [];
  }
}

export function hasSessionCookie(cookies: UpstreamCookie[]): boolean {
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has('sessionid') || names.has('csrftoken') || names.has('session_id');
}