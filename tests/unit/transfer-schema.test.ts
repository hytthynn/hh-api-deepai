import { describe, expect, it } from 'vitest';
import { TRANSFER_FORMAT, transferSchema } from '@/src/core/accounts/transfer';

const minimal = {
  format: TRANSFER_FORMAT,
  version: 1,
  exportedAt: '2026-11-17T00:00:00.000Z',
  accounts: [{ email: 'a@example.com', passwordEnc: 'v1.iv.tag.ct' }],
};

describe('transfer schema (SPEC §17.5)', () => {
  it('accepts a minimal transfer with ciphertext carried as-is', () => {
    const parsed = transferSchema.parse(minimal);
    expect(parsed.accounts[0]?.email).toBe('a@example.com');
    expect(parsed.accounts[0]?.cookiesEnc ?? null).toBeNull();
    expect(parsed.accounts[0]?.balance ?? 0).toBe(0);
  });

  it('accepts the full account shape', () => {
    const parsed = transferSchema.parse({
      ...minimal,
      accounts: [
        {
          email: 'a@example.com',
          passwordEnc: 'v1.iv.tag.ct',
          cookiesEnc: 'v1.iv.tag.ct2',
          machine: 'm-1',
          balance: 12.5,
          granted: 50,
          refreshAt: '2026-11-17T00:00:00.000Z',
          laneVersion: 3,
        },
      ],
    });
    expect(parsed.accounts[0]?.laneVersion).toBe(3);
    expect(parsed.accounts[0]?.machine).toBe('m-1');
  });

  it('rejects foreign formats and future versions', () => {
    expect(transferSchema.safeParse({ ...minimal, format: 'other' }).success).toBe(false);
    expect(transferSchema.safeParse({ ...minimal, version: 2 }).success).toBe(false);
  });

  it('rejects accounts without email or password ciphertext', () => {
    expect(transferSchema.safeParse({ ...minimal, accounts: [{ passwordEnc: 'v1.x' }] }).success).toBe(false);
    expect(transferSchema.safeParse({ ...minimal, accounts: [{ email: 'a@example.com' }] }).success).toBe(false);
    expect(transferSchema.safeParse({ ...minimal, accounts: [] }).success).toBe(true);
  });
});