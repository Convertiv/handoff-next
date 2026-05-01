import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import ReferenceClient from './ReferenceClient';

export const metadata: Metadata = {
  title: 'Reference materials',
  description: 'Generated LLM context from catalog and tokens',
};

export default async function AdminReferencePage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/reference');
  }
  if (session.user.role !== 'admin') {
    return <ReferenceClient config={config} menu={menu} message="You need administrator access to view this page." />;
  }

  return <ReferenceClient config={config} menu={menu} />;
}
