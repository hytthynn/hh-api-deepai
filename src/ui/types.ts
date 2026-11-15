export type AccountStatus = 'pending' | 'active' | 'cooldown' | 'exhausted' | 'dead' | 'disabled';

export type AccountPublic = {
  id: number;
  email: string;
  machine: string | null;
  status: AccountStatus;
  balance: number;
  granted: number;
  refreshAt: string | null;
  laneVersion: number | null;
  lastUsedAt: number | null;
  lastCheckedAt: number | null;
  cooldownUntil: number;
  failCount: number;
  successCount: number;
  source: string;
  bmOrderId: number | null;
  createdAt: number;
  updatedAt: number;
  notes: string | null;
  maskedEmail: string;
  hasCookies: boolean;
};

export type AccountsResponse = { rows: AccountPublic[]; total: number; page: number; per: number };

export type ApiKeyRow = {
  id: number;
  name: string;
  prefix: string;
  last4: string;
  token_limit: number | null;
  created_at: number;
  last_used_at: number | null;
};

export type KeysResponse = { keys: ApiKeyRow[] };

export type KeyRevealResponse = { key: string; record: ApiKeyRow };

export type ImportResponse = {
  jobId: number | null;
  created: number;
  skipped: string[];
  invalid: string[];
  total: number;
};

export type ModelRow = {
  id: string;
  display_name: string;
  free: boolean;
  premier: boolean;
  context_window: number | null;
  max_tokens: number | null;
  modalities: string[];
  enabled: boolean;
  synced_at: number;
};

export type ModelsResponse = { models: ModelRow[]; last_sync_at: number | null };

export type LogRow = {
  id: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  accountId: number | null;
  requestId: string | null;
  meta: string | null;
};

export type LogsResponse = { rows: LogRow[]; next_before: number | null };

export type RequestRow = {
  id: number;
  ts: number;
  requestId: string;
  apiKeyId: number | null;
  keyName: string | null;
  endpoint: 'chat' | 'responses' | 'messages' | 'count_tokens' | 'models';
  model: string | null;
  stream: number;
  accountId: number | null;
  accountEmail: string | null;
  attempts: number;
  httpStatus: number | null;
  latencyMs: number | null;
  firstByteMs: number | null;
  inputTokens: number;
  outputTokens: number;
  theosBefore: number | null;
  theosAfter: number | null;
  errorCode: string | null;
  client: string | null;
  detail: string | null;
};

export type RequestsResponse = { rows: RequestRow[]; total: number; page: number; per: number };

export type Job = {
  id: number;
  type: 'provision' | 'login' | 'probe' | 'models_sync';
  status: 'queued' | 'running' | 'cancelled' | 'done' | 'failed';
  params: string;
  total: number;
  done: number;
  ok: number;
  failed: number;
  spentUsd: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type JobItem = {
  id: number;
  jobId: number;
  email: string | null;
  stage: string;
  attempts: number;
  error: string | null;
  accountId: number | null;
  updatedAt: number;
};

export type JobResponse = { job: Job; items: JobItem[]; running: boolean };

export type JobsListResponse = { jobs: Job[] };

export type OverviewResponse = {
  accounts: {
    total: number;
    active: number;
    cooldown: number;
    exhausted: number;
    dead: number;
    pending: number;
    disabled: number;
  };
  balance_theos: number;
  bm: { configured: boolean; wallet_usd: number | null; error: string | null };
  today: {
    requests: number;
    errors: number;
    error_rate: number;
    p95_ms: number;
    input_tokens: number;
    output_tokens: number;
    theos_spent: number;
  };
  recent_errors: Array<{ ts: number; scope: string; message: string; request_id: string | null }>;
  runtime: { warnings: string[]; locked: boolean; started_at: number; models_sync_due: boolean };
};

export type StatsResponse = {
  range: '24h' | '7d' | '30d';
  totals: {
    requests: number;
    errors: number;
    error_rate: number;
    streams: number;
    input_tokens: number;
    output_tokens: number;
    theos_spent: number;
  };
  latency: { p50: number; p95: number; p99: number };
  series: Array<{ t: number; requests: number; errors: number; tokens: number }>;
  by_model: Array<{ model: string; requests: number; errors: number; p95: number }>;
  by_account: Array<{ email: string; requests: number; errors: number; balance: number }>;
  top_errors: Array<{ code: string; count: number }>;
};

export type SettingsResponse = {
  values: Record<string, string | null>;
  secrets: { 'bm.api_key': boolean; 'admin.password_hash': boolean };
  masked: { 'bm.api_key': string };
  retention: { logs_days: number; requests_days: number };
};

export type BmTestResponse = {
  ok: boolean;
  wallet?: { balance: number; currency: string };
  product?: {
    id: number;
    name: string;
    price: number;
    currency: string;
    allowed_quantities: number[];
    in_stock: boolean;
  };
  code?: string;
  error?: string;
};

export type EngineResponse = {
  health: { python: string; playwright: string; chrome: string; chrome_ok: boolean } | null;
  chrome_ok: boolean;
  settings: { workers: number; restartAfter: number; headless: boolean; proxy: string | null };
};

export type HealthResponse = { status: string; ready: boolean; locked: boolean; error: string | null; uptime_sec: number };