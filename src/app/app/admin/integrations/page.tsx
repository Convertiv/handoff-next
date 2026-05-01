import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import IntegrationsClient from './IntegrationsClient';

export const metadata: Metadata = {
  title: 'Integrations',
  description: 'Manage third-party integrations',
};

export default async function AdminIntegrationsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!usePostgres()) {
    return (
      <IntegrationsClient
        config={config}
        menu={menu}
        message="OAuth integrations require Postgres (set DATABASE_URL)."
      />
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/integrations');
  }
  if (session.user.role !== 'admin') {
    return (
      <IntegrationsClient
        config={config}
        menu={menu}
        message="You need administrator access to view this page."
      />
    );
  }

  return <IntegrationsClient config={config} menu={menu} />;
}
