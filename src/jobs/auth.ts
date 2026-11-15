import 'server-only';
import type { Account } from '@/src/core/entities/account';
import type { JobItem } from '@/src/core/entities/job';
import type { ParsedLogin } from '@/src/core/ports/bm';
import { serializeCookies } from '@/src/adapters/upstream/cookies';
import {
  createAccount,
  getAccount,
  getAccountByEmail,
  updateAccount,
} from '@/src/adapters/db/repositories/accounts';
import { incrementJob, updateJobItem } from '@/src/adapters/db/repositories/jobs';
import { encrypt } from '@/src/lib/crypto';
import { jobMessageId } from '@/src/lib/ids';
import { logger } from '@/src/lib/logger';
import { engineHealth, enginePool } from '@/src/server/engine';
import { probeAccount } from './probe';
import { cancelRequested } from './runner';

export const REGISTER_TIMEOUT_MS = 180_000;
/** One bad login is not retried: `GOOGLE_CAPTCHA`, `ALLAUTH_FAIL` and friends are final (SPEC §17.3). */
const AUTH_ATTEMPTS = 3;
const RETRYABLE_STAGE = /^(TIMEOUT|exc:|launch_err|engine_)/;

export class EngineNotReadyError extends Error {
  readonly code = 'engine_not_ready';

  constructor(message: string) {
    super(message);
    this.name = 'EngineNotReadyError';
  }
}

/**
 * Chrome is the only way in, so a job must not start without it. Returns the human text
 * (routes pass it to `engine_not_ready`, 400) or `null` when the worker is ready.
 */
export async function enginePreflightError(): Promise<string | null> {
  const health = await engineHealth();
  if (!health) {
    return 'Python-воркер не отвечает. Проверьте Python и Playwright: npm run doctor.';
  }
  if (!health.chrome_ok) {
    return 'Браузер для регистрации не найден. Установите Google Chrome, задайте HH_CHROME или выполните python -m playwright install chromium.';
  }
  return null;
}

export async function assertEngineReady(): Promise<void> {
  const message = await enginePreflightError();
  if (message) throw new EngineNotReadyError(message);
}

export function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

export type AuthOptions = {
  headless: boolean;
  proxy: string | null;
  /** `accounts.source` for a row created here; an existing row keeps its own source. */
  source: string;
  /** Stage an interrupted item returns to, so the run stays resumable (SPEC §17.1). */
  cancelStage: string;
  onCancel: () => boolean;
  signal: AbortSignal;
};

export type AuthOutcome = { ok: boolean; account: Account | null; reason: string | null };

function cancelledItem(item: JobItem, cancelStage: string): AuthOutcome {
  updateJobItem(item.id, { stage: cancelStage, error: 'cancelled' });
  return { ok: false, account: null, reason: 'cancelled' };
}

/**
 * SPEC §17.3: `registering → probing → ok|failed` for one login, including cookie
 * persistence and the post-login probe that promotes the account to `active`.
 * Shared by `provision` (fresh BM logins) and `login` (imported logins).
 */
export async function authenticateItem(
  item: JobItem,
  login: ParsedLogin,
  options: AuthOptions,
): Promise<AuthOutcome> {
  for (let attempt = 1; attempt <= AUTH_ATTEMPTS; attempt += 1) {
    if (options.onCancel() || options.signal.aborted) return cancelledItem(item, options.cancelStage);
    updateJobItem(item.id, { stage: 'registering', attempts: attempt, error: null });
    try {
      const outcome = await enginePool().register({
        id: jobMessageId(),
        email: login.email,
        password: login.password,
        headless: options.headless,
        proxy: options.proxy,
        timeout_ms: REGISTER_TIMEOUT_MS,
        signal: options.signal,
        onStage: (stage) => updateJobItem(item.id, { stage }),
      });
      if (options.signal.aborted) return cancelledItem(item, options.cancelStage);
      if (!outcome.ok) {
        const reason = outcome.detail ? `${outcome.stage}: ${outcome.detail}` : outcome.stage;
        if (RETRYABLE_STAGE.test(outcome.stage) && attempt < AUTH_ATTEMPTS) {
          logger.warn('jobs', `register ${login.email} failed (${outcome.stage}), retry ${attempt}/${AUTH_ATTEMPTS}`, {
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
          source: options.source,
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
      if (isAbort(error, options.signal)) return cancelledItem(item, options.cancelStage);
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < AUTH_ATTEMPTS && /launch|timeout|EPIPE|spawn/i.test(message)) {
        logger.warn('jobs', `register ${login.email} crashed (${message}), retry ${attempt}/${AUTH_ATTEMPTS}`);
        continue;
      }
      updateJobItem(item.id, { stage: 'failed', error: message.slice(0, 300) });
      logger.error('jobs', `register ${login.email} crashed: ${message}`);
      return { ok: false, account: null, reason: message };
    }
  }
  return { ok: false, account: null, reason: 'retries_exhausted' };
}

export type AuthQueueOptions = Omit<AuthOptions, 'onCancel'> & { workers: number };

/** Runs the item queue with `workers` in flight; counters land in `jobs` (SPEC §17.1). */
export async function runAuthQueue(
  jobId: number,
  queue: JobItem[],
  logins: Map<number, ParsedLogin>,
  options: AuthQueueOptions,
): Promise<void> {
  const pending = [...queue];
  const workers = Math.max(1, Math.min(options.workers, pending.length || 1));
  const onCancel = (): boolean => cancelRequested(jobId);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        if (onCancel() || options.signal.aborted) return;
        const item = pending.shift();
        if (!item) return;
        const login = logins.get(item.id);
        if (!login) {
          updateJobItem(item.id, { stage: 'failed', error: 'bad_line' });
          incrementJob(jobId, { done: 1, failed: 1 });
          continue;
        }
        const outcome = await authenticateItem(item, login, { ...options, onCancel });
        if (outcome.reason === 'cancelled') return;
        incrementJob(jobId, { done: 1, ok: outcome.ok ? 1 : 0, failed: outcome.ok ? 0 : 1 });
      }
    }),
  );
}