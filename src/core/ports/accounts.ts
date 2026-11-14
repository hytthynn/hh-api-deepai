import type { Account } from '../entities/account';

export type AccountStore = {
  listCandidates(free: boolean): Account[];
  get(id: number): Account | null;
  update(id: number, patch: Partial<Account>): void;
};

export type SlotRelease = () => void;

export type SlotManager = {
  tryAcquire(accountId: number, requestId: string, now?: number): SlotRelease | null;
  isBusy(accountId: number, now?: number): boolean;
  drain(): Promise<void>;
  size(): number;
};