import type { Metadata as NextMetadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import { auth } from '@/lib/auth';
import AssetsClient from './AssetsClient';

export async function generateMetadata(): Promise<NextMetadata> {
  return {
    title: 'Asset library',
    description: 'Browse and manage design system assets — logos, icons, and images.',
  };
}

export default async function AssetsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/design/assets');
  }

  return <AssetsClient config={config} menu={menu} />;
}
