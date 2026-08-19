import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { isPostgres } from '../../../lib/db/dialect';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import ProtectionClient from './ProtectionClient';

export const metadata: Metadata = {
  title: 'Site protection',
  description: 'Password-protect this deployment',
};

export default async function AdminProtectionPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!isPostgres()) {
    return (
      <ProtectionClient config={config} menu={menu} message="Site protection requires Postgres (set DATABASE_URL)." />
    );
  }

  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=/admin/protection');
  if (session.user.role !== 'admin') {
    return (
      <ProtectionClient config={config} menu={menu} message="You need administrator access to view this page." />
    );
  }

  return <ProtectionClient config={config} menu={menu} />;
}
