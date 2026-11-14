import { createHash, randomBytes } from 'node:crypto';
import type { UpstreamCookie } from '@/src/core/ports/upstream';

export const API_BASE = 'https://api.deepai.org';
export const OAUTH_START = `${API_BASE}/accounts/google/login/?process=login`;
export const CHAT_PATH = '/deepai_code/chat/completions';
export const THEOS_PATH = '/deepai_code/theos';
export const MODELS_PATH = '/deepai_code/models';

export const DEFAULT_LANE_VERSION = 4;
export const BEACON = 'v=1.3.0;up=120;pi=0;focus=1';

/** Node cannot read the Windows MachineGuid, so a fresh random device id is derived per account. */
export function deriveMachine(seed?: string): string {
  const raw = seed ?? randomBytes(32).toString('hex');
  return createHash('sha256').update(raw).digest('hex');
}

export function rotateMachine(email: string): string {
  return deriveMachine(`${email}:${randomBytes(32).toString('hex')}`);
}

export function sessionHeaders(): Record<string, string> {
  return {
    'User-Agent': 'DeepAI-Code',
    Origin: 'https://deepai.org',
    Referer: 'https://deepai.org/',
  };
}

export function laneHeaders(options: {
  machine?: string | null;
  laneVersion?: number | null;
  instance?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-DeepAI-Code-Theos': String(options.laneVersion && options.laneVersion > 0 ? options.laneVersion : DEFAULT_LANE_VERSION),
    'X-DeepAI-Code-Instance': options.instance ?? randomBytes(16).toString('hex'),
    'X-DeepAI-Code-Beacon': BEACON,
  };
  if (options.machine) headers['X-DeepAI-Code-Machine'] = options.machine;
  return headers;
}

export function cookieHeader(cookies: UpstreamCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
}