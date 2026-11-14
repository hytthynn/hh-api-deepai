import 'server-only';
import { env, ORIGIN } from '@/src/lib/config';
import { hmacSha256Base64Url, passwordHash, passwordVerify, safeEqual } from '@/src/lib/crypto';
import { getSetting, setSetting } from '@/src/adapters/db/repositories/settings';

export const SESSION_COOKIE = 'hh_session';
const SESSION_TTL_MS = 7 * 86_400_000;
const LOGIN_WINDOW_MS = 600_000;
const LOGIN_MAX_ATTEMPTS = 5;

type SessionPayload = { sub: 'admin'; iat: number; exp: number };

type AttemptBucket = { count: number; resetAt: number };
const attempts = new Map<string, AttemptBucket>();

export function signSession(now = Date.now()): string {
  const payload: SessionPayload = { sub: 'admin', iat: now, exp: now + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmacSha256Base64Url(body)}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, hmacSha256Base64Url(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.sub !== 'admin') return false;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
    return true;
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function isAuthenticated(request: Request): boolean {
  return verifySession(readCookie(request, SESSION_COOKIE));
}

export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Password lives in `settings.admin_password_hash`; `.env.local` is only the bootstrap seed. */
export function verifyAdminPassword(password: string): boolean {
  const stored = getSetting('admin.password_hash');
  if (stored) return passwordVerify(password, stored);
  if (!env.adminPassword) return false;
  return safeEqual(password, env.adminPassword);
}

export function hasAdminPassword(): boolean {
  return getSetting('admin.password_hash') !== null || env.adminPassword.length > 0;
}

export function changeAdminPassword(password: string): void {
  setSetting('admin.password_hash', passwordHash(password));
}

export function loginAllowed(ip: string, now = Date.now()): boolean {
  const bucket = attempts.get(ip);
  if (!bucket) return true;
  if (bucket.resetAt <= now) {
    attempts.delete(ip);
    return true;
  }
  return bucket.count < LOGIN_MAX_ATTEMPTS;
}

export function noteLoginFailure(ip: string, now = Date.now()): void {
  const bucket = attempts.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function resetLoginAttempts(): void {
  attempts.clear();
}

/**
 * SPEC §22.6: mutations accept only the local origin or a request without Origin
 * (curl). Everything else is a CSRF failure.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const allow = new Set([ORIGIN, `http://localhost:${env.port}`]);
  return allow.has(origin);
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}