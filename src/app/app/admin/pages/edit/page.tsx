import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../../lib/auth';
import { getDataProvider } from '../../../../lib/data';
import { getClientRuntimeConfig } from '../../../../components/util';
import { getHandoffPageBySlug } from '../../../../lib/server/doc-pages';
import PageEditorClient from './PageEditorClient';

export const metadata: Metadata = {
  title: 'Edit Page',
};

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPageEditorPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/pages');
  }

  const { slug } = await searchParams;
  const trimmedSlug = (slug ?? '').trim();

  if (!trimmedSlug) {
    redirect('/admin/pages');
  }

  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  let initialPage: Awaited<ReturnType<typeof getHandoffPageBySlug>> = null;
  try {
    initialPage = await getHandoffPageBySlug(trimmedSlug);
  } catch {
    initialPage = null;
  }

  return (
    <PageEditorClient
      slug={trimmedSlug}
      initialPage={initialPage}
      config={config}
      menu={menu}
    />
  );
}
