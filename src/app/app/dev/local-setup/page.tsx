import { Metadata } from 'next';
import { Suspense } from 'react';
import Layout from '@/components/Layout/Main';
import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import LocalSetupClient from './LocalSetupClient';
import HeadersType from '@/components/Typography/Headers';
import { usePostgres } from '@/lib/db/dialect';

export const metadata: Metadata = {
  title: 'Develop locally',
  description: 'Connect the Handoff CLI to this deployment',
};

export default async function LocalSetupPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const layoutMeta = {
    metaTitle: 'Develop locally',
    metaDescription: 'CLI sync and OAuth device login',
    title: 'Develop locally',
    description: 'Connect your laptop to this Handoff instance using the CLI.',
  };

  return (
    <Layout config={config} menu={menu} current={undefined} metadata={layoutMeta}>
      <div className="mx-auto max-w-2xl space-y-6 pb-12">
        <HeadersType.H1>Develop locally</HeadersType.H1>
        {!usePostgres() ? (
          <p className="text-sm text-muted-foreground">
            This deployment uses embedded SQLite. CLI sync targets a <strong>hosted Postgres</strong> team instance — use those docs from your production URL.
          </p>
        ) : null}
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <LocalSetupClient />
        </Suspense>
      </div>
    </Layout>
  );
}
