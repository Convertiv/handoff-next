import { Metadata } from 'next';
import { Suspense } from 'react';
import Layout from '@/components/Layout/Main';
import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import CliDeviceClient from './CliDeviceClient';
import HeadersType from '@/components/Typography/Headers';
import { usePostgres } from '@/lib/db/dialect';

export const metadata: Metadata = {
  title: 'Authorize CLI',
  description: 'Complete Handoff CLI device login',
};

export default async function CliDevicePage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const layoutMeta = {
    metaTitle: 'Authorize CLI',
    metaDescription: 'Authorize the Handoff CLI for sync',
    title: 'Authorize CLI',
    description: '',
  };

  if (!usePostgres()) {
    return (
      <Layout config={config} menu={menu} current={undefined} metadata={layoutMeta}>
        <p className="text-sm text-muted-foreground">
          CLI device login is only available when this app uses Postgres (<code className="rounded bg-muted px-1">DATABASE_URL</code>).
        </p>
      </Layout>
    );
  }

  return (
    <Layout config={config} menu={menu} current={undefined} metadata={layoutMeta}>
      <div className="mx-auto max-w-lg space-y-6 pb-8">
        <HeadersType.H1>Authorize Handoff CLI</HeadersType.H1>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <CliDeviceClient />
        </Suspense>
      </div>
    </Layout>
  );
}
