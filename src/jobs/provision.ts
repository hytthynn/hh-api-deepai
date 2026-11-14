import 'server-only';
import type { Job, JobItem } from '@/src/core/entities/job';
import type { Account } from '@/src/core/entities/account';
import type { ParsedLogin } from '@/src/core/ports/bm';
import { BmClient, BmError, bmConfigFromSettings, parseLogins } from '@/src/adapters/bm/client';
import { serializeCookies } from '@/src/adapters/upstream/cookies';
import {
  addJobItem,
  createJob,
  getJob,
  incrementJob,
  isJobCancelled,
  pendingJobItems,
  updateJob,
  updateJobItem,
} from '@/src/adapters/db/repositories/jobs';
import {
  createAccount,
  getAccount,
  getAccountByEmail,
  updateAccount,
} from '@/src/adapters/db/repositories/accounts';
import { getBool, getInt, getSetting } from '@/src/adapters/db/repositories/settings';
import { encrypt } from '@/src/lib/crypto';
import { jobMessageId } from '@/src/lib/ids';
import { logger } from '@/src/lib/logger';
import { enginePool } from '@/src/server/engine';
import { probeAccount } from './probe';
import { beginRun, endRun } from './runner';

export type ProvisionParams = {
  quantity: number;
  productId?: number;
  workers?: number;
  headless?: boolean;
  proxy?: string;
  resumeJobId?: number;
};

const ORDER_POLL_ATTEMPTS = 40;
const ORDER_POLL_MS = 3_000;
const REGISTER_TIMEOUT_MS = 180_000;
const RETRYABLE_STAGE = /^(TIMEOUT|exc:|launch_err|engine_)/;

export function createProvisionJob(params: ProvisionParams): Job {
  return createJob({ type: 'provision', params, total: Math.max(1, params.quantity) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function bmClient(): BmClient {
  const config = bmConfigFromSettings(getSetting);
  if (!config) throw new BmError('bm_not_configured', 'API-ключ BM не задан. Откройте «Настройки» и сохраните ключ.');
  return new BmClient(config);
}

type PurchaseResult = { orderId: number; items: string[]; totalAmount: number };

async function purchase(quantity: number, productId: number): Promise<PurchaseResult> {
  const client = bmClient();

  const wallet = await client.wallet();
  const product = await client.product(productId);
  const estimate = product.price * quantity;
  if (!product.inStock) {
    throw new BmError('bm_insufficient_stock', `Товар «${product.name}» закончился на складе BM`);
  }
  if (wallet.balance < estimate) {
    throw new BmError(
      'bm_insufficient_balance',
      `Недостаточно средств: нужно $${estimate.toFixed(2)}, в кошельке $${wallet.balance.toFixed(2)}`,
    );
  }
  const allowed = product.allowedQuantities;
  if (!allowed.includes(quantity)) {
    logger.warn('bm', `quantity ${quantity} not in allowed list [${allowed.join(', ')}], buying the closest value`);
  }

  const order = await client.createOrder(productId, quantity);
  logger.info('bm', `order ${order.id} created: ${quantity} × $${product.price.toFixed(2)}`, {
    meta: { order_id: order.id, quantity, total: order.totalAmount },
  });

  let items = order.items;
  if (items.length === 0) {
    for (let attempt = 1; attempt <= ORDER_POLL_ATTEMPTS && items.length === 0; attempt += 1) {
      await sleep(ORDER_POLL_MS);
      const fresh = await client.getOrder(order.id);
      if (fresh.status === 'cancelled' || fresh.status === 'refunded') {
        throw new BmError('bm_bad_response', `BM вернул refund по заказу ${order.id}`);
      }
      items = fresh.items;
    }
  }
  if (items.length === 0) {
    items = await client.purchases(order.id);
  }
  if (items.length === 0) {
    throw new BmError('bm_bad_response', `BM не выдал логины по заказу ${order.id} за 120 с`);
  }
  return { orderId: order.id, items, totalAmount: order.totalAmount > 0 ? order.totalAmount : estimate };
}

function loadPendingItems(jobId: number): JobItem[] {
  return pendingJobItems(jobId);
}

async function registerItem(
  item: JobItem,
  login: ParsedLogin,
  options: { headless: boolean; proxy: string | null; onCancel: () => boolean },
): Promise<{ ok: boolean; account: Account | null; reason: string | null }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (options.onCancel()) return { ok: false, account: null, reason: 'cancelled' };
    updateJobItem(item.id, { stage: 'registering', attempts: attempt, error: null });
    try {
      const outcome = await enginePool().register({
        id: jobMessageId(),
        email: login.email,
        password: login.password,
        headless: options.headless,
        proxy: options.proxy,
        timeout_ms: REGISTER_TIMEOUT_MS,
        onStage: (stage) => updateJobItem(item.id, { stage }),
      });
      if (!outcome.ok) {
        const reason = outcome.detail ? `${outcome.stage}: ${outcome.detail}` : outcome.stage;
        if (RETRYABLE_STAGE.test(outcome.stage) && attempt < 3) {
          logger.warn('jobs', `register ${login.email} failed (${outcome.stage}), retry ${attempt}/3`, {
            meta: { stage: outcome.stage },
          });
          continue;
        }
        updateJobItem(item.id, { stage: 'failed', error: reason.slice(0, 300) });
        logger.warn('jobs', `register ${login.email} failed: ${reason}`, { meta: { stage: outcome.stage } });
        return { ok: false, account: null, reason };
      }

      updateJobItem(item.id, { stage: 'probing' });
      const cookiesEnc = encrypt(serializeCookies(outcome.cookies));
      const passwordEnc = encrypt(login.password);
      const existing = getAccountByEmail(login.email);
      let accountId: number;
      if (existing) {
        updateAccount(existing.id, {
          cookiesEnc,
          passwordEnc,
          machine: outcome.machine ?? existing.machine,
          status: 'pending',
        });
        accountId = existing.id;
      } else {
        const created = createAccount({
          email: login.email,
          passwordEnc,
          cookiesEnc,
          machine: outcome.machine,
          status: 'pending',
          source: 'bm',
        });
        accountId = created.id;
      }
      updateJobItem(item.id, { accountId, email: login.email });

      const account = getAccount(accountId);
      if (!account) return { ok: false, account: null, reason: 'account_not_found' };
      const probe = await probeAccount(account, { chat: true });
      if (!probe.ok) {
        updateJobItem(item.id, { stage: 'failed', error: `probe: ${probe.reason ?? 'failed'}`.slice(0, 300) });
        return { ok: false, account, reason: probe.reason };
      }
      updateJobItem(item.id, { stage: 'ok', error: null });
      return { ok: true, account, reason: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 3 && (error instanceof Error ? /launch|timeout|EPIPE|spawn/i.test(message) : false)) {
        logger.warn('jobs', `register ${login.email} crashed (${message}), retry ${attempt}/3`);
        continue;
      }
      updateJobItem(item.id, { stage: 'failed', error: message.slice(0, 300) });
      logger.error('jobs', `register ${login.email} crashed: ${message}`);
      return { ok: false, account: null, reason: message };
    }
  }
  return { ok: false, account: null, reason: 'retries_exhausted' };
}

async function runRegistration(
  job: Job,
  items: JobItem[],
  logins: Map<number, ParsedLogin>,
  options: { workers: number; headless: boolean; proxy: string | null },
): Promise<void> {
  const queue = [...items];
  const workers = Math.max(1, Math.min(options.workers, queue.length || 1));
  const onCancel = (): boolean => isJobCancelled(job.id);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        if (onCancel()) return;
        const item = queue.shift();
        if (!item) return;
        const login = logins.get(item.id);
        if (!login) {
          updateJobItem(item.id, { stage: 'failed', error: 'bad_line' });
          incrementJob(job.id, { done: 1, failed: 1 });
          continue;
        }
        const outcome = await registerItem(item, login, {
          headless: options.headless,
          proxy: options.proxy,
          onCancel,
        });
        if (outcome.reason === 'cancelled') return;
        incrementJob(job.id, { done: 1, ok: outcome.ok ? 1 : 0, failed: outcome.ok ? 0 : 1 });
      }
    }),
  );
}

/**
 * SPEC §17.1. The job is `done` even when some logins fail; `spent_usd` mirrors the
 * BM order total so the dashboard stays truthful about money.
 */
export async function runProvisionJob(jobId: number): Promise<void> {
  if (!beginRun(jobId, 'provision')) return;
  updateJob(jobId, { status: 'running', startedAt: Date.now() });
  let job: Job | null = null;
  try {
    job = getJob(jobId);
    if (!job) throw new Error(`job ${jobId} disappeared`);
    const params = JSON.parse(job.params) as ProvisionParams;
    const quantity = Math.max(1, Math.min(50, Math.trunc(params.quantity || 1)));
    const productId = params.productId ?? getInt('bm.product_id', 578);
    const headless = params.headless ?? getBool('engine.headless', false);
    const proxy = params.proxy?.trim() || getSetting('engine.proxy') || null;
    const workers = Math.max(1, Math.min(8, params.workers ?? enginePoolWorkers()));

    const logins = new Map<number, ParsedLogin>();
    const queue: JobItem[] = [];

    if (params.resumeJobId) {
      logger.info('jobs', `provision ${jobId}: resuming job ${params.resumeJobId}`);
      for (const source of loadPendingItems(params.resumeJobId)) {
        if (!source.email) continue;
        const item = addJobItem(jobId, { email: source.email, stage: 'purchased' });
        const account = getAccountByEmail(source.email);
        if (account) {
          updateJobItem(item.id, { stage: 'ok', error: 'reused', accountId: account.id });
          incrementJob(jobId, { done: 1, ok: 1 });
          continue;
        }
        queue.push(item);
      }
      if (queue.length === 0) {
        updateJob(jobId, { status: 'done', finishedAt: Date.now() });
        return;
      }
    } else {
      updateJob(jobId, { total: quantity });
      const purchaseResult = await purchase(quantity, productId);
      incrementJob(jobId, { spentUsd: purchaseResult.totalAmount });
      logger.info('jobs', `provision ${jobId}: purchased ${purchaseResult.items.length} logins`);
      const parsed = parseLogins(purchaseResult.items);
      for (const bad of parsed.invalid) {
        addJobItem(jobId, { email: null, stage: 'failed', error: 'bad_line' });
        incrementJob(jobId, { done: 1, failed: 1 });
        logger.warn('jobs', `provision ${jobId}: bad line skipped`, { meta: { sample: bad.slice(0, 40) } });
      }
      for (const login of parsed.parsed) {
        const existing = getAccountByEmail(login.email);
        const item = addJobItem(jobId, { email: login.email, stage: 'purchased' });
        if (existing) {
          updateJobItem(item.id, { stage: 'ok', error: 'reused', accountId: existing.id });
          incrementJob(jobId, { done: 1, ok: 1 });
          continue;
        }
        logins.set(item.id, login);
        queue.push(item);
      }
    }

    await runRegistration(job, queue, logins, { workers, headless, proxy });

    const cancelled = isJobCancelled(jobId);
    updateJob(jobId, { status: cancelled ? 'cancelled' : 'done', finishedAt: Date.now() });
    logger.info('jobs', `provision ${jobId} ${cancelled ? 'cancelled' : 'finished'}`, {
      meta: { job_id: jobId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof BmError ? error.code : 'provision_failed';
    updateJob(jobId, { status: 'failed', error: `${message}`.slice(0, 500), finishedAt: Date.now() });
    logger.error('jobs', `provision ${jobId} failed (${code}): ${message}`, { meta: { job_id: jobId, code } });
  } finally {
    endRun(jobId);
  }
}

function enginePoolWorkers(): number {
  return getInt('engine.workers', 2);
}