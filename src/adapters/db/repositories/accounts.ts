import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, like, lte, or, sql } from 'drizzle-orm';
import type { Account, AccountPublic, AccountStatus } from '@/src/core/entities/account';
import { maskEmail } from '@/src/lib/ids';
import { db } from '../client';
import { accounts } from '../schema';

export function toAccount(row: typeof accounts.$inferSelect): Account {
  return {
    ...row,
    status: row.status as AccountStatus,
  };
}

export function toPublicAccount(account: Account): AccountPublic {
  const { passwordEnc: _password, cookiesEnc: _cookies, ...rest } = account;
  return {
    ...rest,
    maskedEmail: maskEmail(account.email),
    hasCookies: account.cookiesEnc !== null,
  };
}

export function getAccount(id: number): Account | null {
  const row = db().select().from(accounts).where(eq(accounts.id, id)).get();
  return row ? toAccount(row) : null;
}

export function getAccountByEmail(email: string): Account | null {
  const row = db().select().from(accounts).where(eq(accounts.email, email)).get();
  return row ? toAccount(row) : null;
}

/** Import matching is case-insensitive: `Ivan@Mail.ru` and `ivan@mail.ru` are the same login. */
export function getAccountByEmailCI(email: string): Account | null {
  const row = db()
    .select()
    .from(accounts)
    .where(sql`lower(${accounts.email}) = ${email.toLowerCase()}`)
    .get();
  return row ? toAccount(row) : null;
}

export type AccountFilter = { status?: string; q?: string; page?: number; per?: number };

export function listAccounts(filter: AccountFilter = {}): { rows: Account[]; total: number } {
  const per = Math.min(200, Math.max(1, filter.per ?? 50));
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.status && filter.status !== 'all') conditions.push(eq(accounts.status, filter.status));
  if (filter.q) {
    const needle = `%${filter.q.trim()}%`;
    conditions.push(or(like(accounts.email, needle), like(accounts.notes, needle)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = db()
    .select()
    .from(accounts)
    .where(where)
    .orderBy(desc(accounts.id))
    .limit(per)
    .offset((page - 1) * per)
    .all()
    .map(toAccount);
  const totalRow = db().select({ count: sql<number>`count(*)` }).from(accounts).where(where).get();
  return { rows, total: totalRow?.count ?? 0 };
}

export function createAccount(input: {
  email: string;
  passwordEnc: string | null;
  cookiesEnc?: string | null;
  machine?: string | null;
  status?: AccountStatus;
  source?: string;
  bmOrderId?: number | null;
  balance?: number;
  granted?: number;
  refreshAt?: string | null;
  laneVersion?: number | null;
  notes?: string | null;
}): Account {
  const now = Date.now();
  const row = db()
    .insert(accounts)
    .values({
      email: input.email,
      passwordEnc: input.passwordEnc,
      cookiesEnc: input.cookiesEnc ?? null,
      machine: input.machine ?? null,
      status: input.status ?? 'pending',
      balance: input.balance ?? 0,
      granted: input.granted ?? 0,
      refreshAt: input.refreshAt ?? null,
      laneVersion: input.laneVersion ?? null,
      source: input.source ?? 'manual',
      bmOrderId: input.bmOrderId ?? null,
      createdAt: now,
      updatedAt: now,
      notes: input.notes ?? null,
    })
    .returning()
    .get();
  return toAccount(row);
}

export type AccountPatch = Partial<{
  passwordEnc: string | null;
  cookiesEnc: string | null;
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
  notes: string | null;
}>;

export function updateAccount(id: number, patch: AccountPatch): void {
  db()
    .update(accounts)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(accounts.id, id))
    .run();
}

export function deleteAccount(id: number): void {
  db().delete(accounts).where(eq(accounts.id, id)).run();
}

export function pickCandidates(free: boolean, now = Date.now()): Account[] {
  const conditions = [
    inArray(accounts.status, ['active', 'exhausted']),
    isNotNull(accounts.cookiesEnc),
    lte(accounts.cooldownUntil, now),
  ];
  if (!free) conditions.push(sql`${accounts.balance} > 0`);
  return db()
    .select()
    .from(accounts)
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${accounts.status} = 'active' THEN 0 ELSE 1 END`,
      sql`COALESCE(${accounts.lastUsedAt}, 0) ASC`,
    )
    .limit(50)
    .all()
    .map(toAccount);
}

export function countByStatus(): Record<string, number> {
  const rows = db()
    .select({ status: accounts.status, count: sql<number>`count(*)` })
    .from(accounts)
    .groupBy(accounts.status)
    .all();
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = row.count;
  return out;
}

export function totalBalance(): number {
  const row = db().select({ sum: sql<number>`COALESCE(SUM(${accounts.balance}), 0)` }).from(accounts).get();
  return row?.sum ?? 0;
}

export function listForBalanceSync(): Account[] {
  return db()
    .select()
    .from(accounts)
    .where(inArray(accounts.status, ['active', 'cooldown', 'exhausted']))
    .orderBy(asc(accounts.lastCheckedAt))
    .all()
    .map(toAccount);
}

export function listActiveEmails(): string[] {
  return db()
    .select({ email: accounts.email })
    .from(accounts)
    .all()
    .map((r) => r.email);
}