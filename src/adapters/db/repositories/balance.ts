import 'server-only';
import { asc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../client';
import { balanceSamples } from '../schema';

export function addBalanceSample(input: {
  accountId: number;
  ts?: number;
  balance: number;
  granted: number;
  refreshAt: string | null;
}): void {
  db()
    .insert(balanceSamples)
    .values({
      accountId: input.accountId,
      ts: input.ts ?? Date.now(),
      balance: input.balance,
      granted: input.granted,
      refreshAt: input.refreshAt,
    })
    .run();
}

export function samplesFor(accountId: number, from = 0) {
  return db()
    .select()
    .from(balanceSamples)
    .where(gte(balanceSamples.accountId, accountId))
    .orderBy(asc(balanceSamples.ts))
    .all()
    .filter((row) => row.accountId === accountId && row.ts >= from);
}

export function purgeSamples(days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  return db().delete(balanceSamples).where(lt(balanceSamples.ts, cutoff)).run().changes;
}

export function latestSample(accountId: number) {
  return db().select().from(balanceSamples).where(eq(balanceSamples.accountId, accountId)).orderBy(asc(balanceSamples.ts)).all().at(-1) ?? null;
}