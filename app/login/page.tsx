import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, hasAdminPassword, verifySession } from '@/src/server/auth';
import { LoginForm } from '@/src/ui/login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const store = await cookies();
  if (verifySession(store.get(SESSION_COOKIE)?.value)) redirect('/');
  return (
    <div className="login-wrap">
      <LoginForm passwordConfigured={hasAdminPassword()} />
    </div>
  );
}