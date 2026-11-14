import { beforeEach, describe, expect, it, vi } from 'vitest';

type TheosCall = { status: number; body: unknown };

const theosResponse: TheosCall = { status: 200, body: null };
let chatFails = false;

vi.mock('@/src/adapters/upstream/deepai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/adapters/upstream/deepai')>();
  return {
    ...actual,
    upstream: {
      ...actual.upstream,
      theos: async () => ({ status: theosResponse.status, body: theosResponse.body }),
      complete: async () => {
        if (chatFails) throw new Error('upstream 403');
        return {
          text: 'ok',
          reasoning: '',
          toolCalls: [],
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
          id: 'gen-probe',
          model: 'glm-5.3-flash',
          created: 0,
        };
      },
    },
  };
});

import { closeDb } from '@/src/adapters/db/client';
import { runMigrations } from '@/src/adapters/db/migrate';
import { createAccount, getAccount, updateAccount } from '@/src/adapters/db/repositories/accounts';
import { serializeCookies } from '@/src/adapters/upstream/cookies';
import { encrypt } from '@/src/lib/crypto';
import type { Account } from '@/src/core/entities/account';
import { probeAccount } from '@/src/jobs/probe';

const THEOS_OK = {
  enabled: true,
  balance: '0.00000',
  granted: '0.00000',
  refresh_at: '2026-11-15T13:06:44+00:00',
  lane_version: 6,
};

const CHECK_IN_REFUSED = {
  error: {
    message: 'DeepAI models are temporarily unavailable. Try again later.',
    type: 'check_in_refused',
    code: 'check_in_refused',
  },
};

beforeEach(() => {
  closeDb();
  runMigrations();
  theosResponse.status = 200;
  theosResponse.body = THEOS_OK;
  chatFails = false;
});

function seedAccount(status: 'active' | 'dead', failCount: number): Account {
  const account = createAccount({
    email: `probe-${status}-${failCount}-${Date.now()}@ecolu.us`,
    passwordEnc: null,
    cookiesEnc: encrypt(serializeCookies([{ name: 'sessionid', value: 'cookie', domain: 'deepai.org' }])),
    machine: `machine-${status}`,
    status,
    balance: 0,
    granted: 0,
    laneVersion: 6,
  });
  if (failCount > 0) updateAccount(account.id, { failCount });
  const fresh = getAccount(account.id);
  if (!fresh) throw new Error('account was not created');
  return fresh;
}

describe('probe: /theos check_in_refused is not an auth failure (B-026)', () => {
  it('keeps the account usable and revives it when chat still answers', async () => {
    const account = seedAccount('dead', 3);
    theosResponse.status = 403;
    theosResponse.body = CHECK_IN_REFUSED;

    const outcome = await probeAccount(account);

    expect(outcome).toMatchObject({ ok: true, reason: null });
    const fresh = getAccount(account.id);
    expect(fresh?.status).toBe('active');
    expect(fresh?.failCount).toBe(0);
    expect(fresh?.cooldownUntil).toBe(0);
  });

  it('never counts a refused check-in as an auth failure when chat is broken too', async () => {
    const account = seedAccount('active', 0);
    theosResponse.status = 403;
    theosResponse.body = CHECK_IN_REFUSED;
    chatFails = true;

    const outcome = await probeAccount(account);

    expect(outcome).toMatchObject({ ok: false, reason: 'check_in_refused' });
    const fresh = getAccount(account.id);
    expect(fresh?.status).toBe('active');
    expect(fresh?.failCount).toBe(0);
    expect(fresh?.cooldownUntil).toBe(0);
  });

  it('still records the balance from a healthy /theos answer', async () => {
    const account = seedAccount('active', 0);
    theosResponse.body = { ...THEOS_OK, balance: '12.50000', granted: '65.00000' };

    const outcome = await probeAccount(account, { chat: true });

    expect(outcome).toMatchObject({ ok: true, balance: 12.5, granted: 65 });
    expect(getAccount(account.id)?.status).toBe('active');
  });
});