export const ACCOUNT_STATUSES = ['pending', 'active', 'cooldown', 'exhausted', 'dead', 'disabled'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type Account = {
  id: number;
  email: string;
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
  source: string;
  bmOrderId: number | null;
  createdAt: number;
  updatedAt: number;
  notes: string | null;
};

export type AccountPublic = Omit<Account, 'passwordEnc' | 'cookiesEnc'> & {
  maskedEmail: string;
  hasCookies: boolean;
};

export function isSelectable(account: Account, free: boolean, now: number): boolean {
  if (account.status !== 'active' && account.status !== 'exhausted') return false;
  if (account.cookiesEnc === null) return false;
  if (account.cooldownUntil > now) return false;
  if (!free && account.balance <= 0) return false;
  return true;
}