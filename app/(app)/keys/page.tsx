import { KeysScreen } from '@/src/ui/screens/keys';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  return <KeysScreen initialCreating={params.new === '1'} />;
}