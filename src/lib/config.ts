import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), name), 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // absent file is fine
    }
  }
}

loadEnvFiles();

const bool = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : Number(v) === 1 || String(v) === 'true'))
  .pipe(z.boolean());

const schema = z.object({
  // ADR-025: optional so platform PORT can take over; resolved below with gateway-aware host.
  HH_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HH_HOST: z.string().optional(),
  PORT: z.preprocess(
    (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : v),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  HH_MODE: z.enum(['full', 'gateway']).default('full'),
  HH_PUBLIC_ORIGIN: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\/+$/, '') : undefined))
    .refine(
      (v) => v === undefined || /^https?:\/\/[^/\s]+$/.test(v),
      'HH_PUBLIC_ORIGIN must be an origin like https://hh.example.com',
    ),
  HH_SECRET: z.string().min(16, 'HH_SECRET must be at least 16 characters (32+ bytes base64)'),
  HH_ADMIN_PASSWORD: z.string().optional(),
  HH_DB_PATH: z.string().default('./data/hh.db'),
  HH_ENGINE_DIR: z.string().default('./engine'),
  HH_PYTHON: z.string().default('python'),
  HH_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  HH_REQUEST_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  HH_DEFAULT_RPM: z.coerce.number().int().min(1).default(60),
  HH_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
  HH_SLOT_WAIT_MS: z.coerce.number().int().min(0).default(45_000),
  HH_MEASURE_THEOS: bool.default(false),
  HH_DEBUG_BODY: bool.default(false),
  HH_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  HH_ALLOW_REMOTE: bool.default(false),
  HH_TEST_MODE: bool.default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment: ${details}. Copy .env.example to .env.local and set HH_SECRET.`);
}

const raw = parsed.data;

// ADR-025: platform PORT (Railway) implies a non-loopback bind unless HH_HOST says otherwise.
const platformPort = raw.PORT;
const port = raw.HH_PORT ?? platformPort ?? 3210;
const openHost = platformPort !== undefined || raw.HH_MODE === 'gateway' || raw.HH_ALLOW_REMOTE;
const host = raw.HH_HOST || (openHost ? '0.0.0.0' : '127.0.0.1');
const publicOrigin = raw.HH_PUBLIC_ORIGIN ?? null;

export const env = {
  port,
  host,
  mode: raw.HH_MODE,
  publicOrigin,
  secureCookie: publicOrigin?.startsWith('https://') ?? false,
  secret: raw.HH_SECRET,
  adminPassword: raw.HH_ADMIN_PASSWORD || '',
  dbPath: raw.HH_DB_PATH === ':memory:' ? ':memory:' : resolve(process.cwd(), raw.HH_DB_PATH),
  engineDir: resolve(process.cwd(), raw.HH_ENGINE_DIR),
  python: raw.HH_PYTHON,
  logRetentionDays: raw.HH_LOG_RETENTION_DAYS,
  requestRetentionDays: raw.HH_REQUEST_RETENTION_DAYS,
  defaultRpm: raw.HH_DEFAULT_RPM,
  upstreamTimeoutMs: raw.HH_UPSTREAM_TIMEOUT_MS,
  slotWaitMs: raw.HH_SLOT_WAIT_MS,
  measureTheos: raw.HH_MEASURE_THEOS,
  debugBody: raw.HH_DEBUG_BODY,
  logLevel: raw.HH_LOG_LEVEL,
  allowRemote: raw.HH_ALLOW_REMOTE,
  testMode: raw.HH_TEST_MODE,
  dataDir: resolve(process.cwd(), './data'),
  profDir: resolve(process.cwd(), './prof'),
} as const;

export const ORIGIN = `http://${env.host === '0.0.0.0' ? '127.0.0.1' : env.host}:${env.port}`;