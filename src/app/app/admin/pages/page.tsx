import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getDataProvider } from '../../../lib/data';
import { getClientRuntimeConfig } from '../../../components/util';
import { listHandoffPages } from '../../../lib/server/doc-pages';
import PagesClient from './PagesClient';

export const metadata: Metadata = {
  title: 'Page Manager',
  description: 'Create, edit, and organise pages in the design system knowledge base',
};

export default async function AdminPagesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/pages');
  }

  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  let initialPages: Awaited<ReturnType<typeof listHandoffPages>> = [];
  try {
    initialPages = await listHandoffPages();
  } catch {
    initialPages = [];
  }

  return <PagesClient initialPages={initialPages} config={config} menu={menu} />;
}
