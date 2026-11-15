import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: integer('encrypted').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull().unique(),
    passwordEnc: text('password_enc'),
    cookiesEnc: text('cookies_enc'),
    machine: text('machine'),
    status: text('status').notNull().default('pending'),
    balance: real('balance').notNull().default(0),
    granted: real('granted').notNull().default(0),
    refreshAt: text('refresh_at'),
    laneVersion: integer('lane_version'),
    lastUsedAt: integer('last_used_at'),
    lastCheckedAt: integer('last_checked_at'),
    cooldownUntil: integer('cooldown_until').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    source: text('source').notNull().default('manual'),
    bmOrderId: integer('bm_order_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    notes: text('notes'),
  },
  (t) => [index('idx_accounts_pick').on(t.status, t.cooldownUntil, t.lastUsedAt)],
);

export const balanceSamples = sqliteTable(
  'balance_samples',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ts: integer('ts').notNull(),
    balance: real('balance').notNull(),
    granted: real('granted').notNull(),
    refreshAt: text('refresh_at'),
  },
  (t) => [index('idx_balance_account_ts').on(t.accountId, t.ts)],
);

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  last4: text('last4').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyEnc: text('key_enc'),
  tokenLimit: integer('token_limit'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

export const models = sqliteTable('models', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  free: integer('free').notNull().default(0),
  premier: integer('premier').notNull().default(0),
  contextWindow: integer('context_window'),
  maxTokens: integer('max_tokens'),
  modalities: text('modalities').notNull().default('text'),
  enabled: integer('enabled').notNull().default(1),
  syncedAt: integer('synced_at').notNull(),
});

export const requests = sqliteTable(
  'requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    requestId: text('request_id').notNull(),
    apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    endpoint: text('endpoint').notNull(),
    model: text('model'),
    stream: integer('stream').notNull().default(0),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    attempts: integer('attempts').notNull().default(1),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    firstByteMs: integer('first_byte_ms'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    theosBefore: real('theos_before'),
    theosAfter: real('theos_after'),
    errorCode: text('error_code'),
    client: text('client'),
    detail: text('detail'),
  },
  (t) => [
    index('idx_requests_ts').on(t.ts),
    index('idx_requests_model_ts').on(t.model, t.ts),
    index('idx_requests_key').on(t.apiKeyId),
  ],
);

export const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    level: text('level').notNull(),
    scope: text('scope').notNull(),
    message: text('message').notNull(),
    accountId: integer('account_id'),
    requestId: text('request_id'),
    meta: text('meta'),
  },
  (t) => [index('idx_logs_ts').on(t.ts), index('idx_logs_scope_level').on(t.scope, t.level, t.ts)],
);

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  params: text('params').notNull(),
  total: integer('total').notNull().default(0),
  done: integer('done').notNull().default(0),
  ok: integer('ok').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  spentUsd: real('spent_usd').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
});

export const jobItems = sqliteTable(
  'job_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    email: text('email'),
    stage: text('stage').notNull(),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    accountId: integer('account_id'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_job_items_job').on(t.jobId)],
);

export const bmOrders = sqliteTable('bm_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bmOrderId: integer('bm_order_id').unique(),
  productId: integer('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price'),
  totalUsd: real('total_usd'),
  status: text('status').notNull(),
  items: integer('items').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  finishedAt: integer('finished_at'),
});

export const responses = sqliteTable(
  'responses',
  {
    id: text('id').primaryKey(),
    apiKeyId: integer('api_key_id'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    request: text('request').notNull(),
    response: text('response').notNull(),
  },
  (t) => [index('idx_responses_expires').on(t.expiresAt)],
);

export const locks = sqliteTable('locks', {
  name: text('name').primaryKey(),
  pid: integer('pid').notNull(),
  ts: integer('ts').notNull(),
});
