import { randomBytes } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export function base36(bytes: number): string {
  const buf = randomBytes(bytes);
  let out = '';
  for (const byte of buf) out += BASE36[byte % 36];
  return out;
}

export function requestId(): string {
  return `req_${base36(12)}`;
}

export function chatCompletionId(): string {
  return `chatcmpl-${base36(24)}`;
}

export function responseId(): string {
  return `resp_${base36(24)}`;
}

export function messageId(): string {
  return `msg_${base36(24)}`;
}

export function toolUseId(): string {
  return `toolu_${base36(24)}`;
}

export function jobMessageId(): string {
  return `job_${base36(8)}`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const head = domain.slice(0, Math.max(0, dot === -1 ? 1 : dot));
  const tail = dot === -1 ? '' : domain.slice(dot);
  return `${local[0] ?? '*'}***@${head[0] ?? '*'}***${tail}`;
}