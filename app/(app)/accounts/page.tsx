import { AccountsScreen } from '@/src/ui/screens/accounts';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ provision?: string }>;
}) {
  const params = await searchParams;
  return <AccountsScreen initialProvision={params.provision === '1'} />;
}