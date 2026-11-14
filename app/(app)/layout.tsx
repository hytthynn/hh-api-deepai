import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SESSION_COOKIE, verifySession } from '@/src/server/auth';
import { AppShell } from '@/src/ui/shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  if (!verifySession(store.get(SESSION_COOKIE)?.value)) redirect('/login');
  return <AppShell>{children}</AppShell>;
}