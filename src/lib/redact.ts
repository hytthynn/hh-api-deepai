const SECRET_KEYS = new Set(
  [
    'password',
    'passwd',
    'pwd',
    'cookies',
    'cookie',
    'authorization',
    'x-api-key',
    'api-key',
    'api_key',
    'apikey',
    'sessionid',
    'csrftoken',
    'secret',
    'token',
    'access_token',
    'refresh_token',
    'hh_secret',
  ].map((k) => k.toLowerCase()),
);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk_live_[A-Za-z0-9]+/g, 'sk_live_«redacted»'],
  [/hh-api-[A-Za-z0-9]{8,}/g, 'hh-api-«redacted»'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1«redacted»'],
  [/(sessionid=)[^;,\s]+/gi, '$1«redacted»'],
  [/(csrftoken=)[^;,\s]+/gi, '$1«redacted»'],
];

export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '«deep»';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '«redacted»' : redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactJson(value: unknown, maxBytes = 2048): string {
  const json = JSON.stringify(redact(value));
  if (json.length <= maxBytes) return json;
  return `${json.slice(0, Math.max(0, maxBytes - 12))}…«trunc»`;
}