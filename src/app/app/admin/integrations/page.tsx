import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { isDynamic } from '../../../lib/mode';
import { getClientRuntimeConfig, staticBuildMenu } from '../../../components/util';
import IntegrationsClient from './IntegrationsClient';

export const metadata: Metadata = {
  title: 'Integrations',
  description: 'Manage third-party integrations',
};

export default async function AdminIntegrationsPage() {
  const config = getClientRuntimeConfig();
  const menu = staticBuildMenu();

  if (!isDynamic()) {
    return (
      <IntegrationsClient
        config={config}
        menu={menu}
        message="Integrations are only available in dynamic mode."
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
