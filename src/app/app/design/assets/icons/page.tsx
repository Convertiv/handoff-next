import type { Metadata as NextMetadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import { auth } from '@/lib/auth';
import IconBrowserClient from './IconBrowserClient';

export async function generateMetadata(): Promise<NextMetadata> {
  return {
    title: 'Icon browser',
    description: 'Browse and copy SVG icons from the design system.',
  };
}

export default async function IconBrowserPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/design/assets/icons');
  }

  return <IconBrowserClient config={config} menu={menu} />;
}
