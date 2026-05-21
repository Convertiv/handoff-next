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
  description: 'CLI sync, device login, and MCP setup for Cursor and Claude',
};

export default async function LocalSetupPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const layoutMeta = {
    metaTitle: 'Develop locally',
    metaDescription: 'CLI sync, OAuth device login, and MCP for AI assistants',
    title: 'Develop locally',
    description: 'Connect your laptop and AI tools (Cursor, Claude) to this Handoff instance.',
  };
  const mcpOnThisHost = usePostgres();
  const fallbackMcpUrl =
    process.env.HANDOFF_CLOUD_URL?.trim().replace(/\/$/, '') ||
    process.env.HANDOFF_SYNC_URL?.trim().replace(/\/$/, '') ||
    '';

  return (
    <Layout config={config} menu={menu} current={undefined} metadata={layoutMeta}>
      <div className="mx-auto max-w-3xl space-y-6 pb-12">
        <HeadersType.H1>Develop locally</HeadersType.H1>
        <p className="text-sm text-muted-foreground">
          Connect the CLI for sync, then add Handoff MCP in Cursor or Claude Desktop using the same login token.
        </p>
        {!mcpOnThisHost ? (
          <p className="text-sm text-muted-foreground">
            This process has no local database. Set <code className="rounded bg-muted px-1">HANDOFF_CLOUD_URL</code> in your project{' '}
            <code className="rounded bg-muted px-1">.env</code> to point at a <strong>hosted Postgres</strong> team instance, then use the steps below.
          </p>
        ) : null}
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <LocalSetupClient mcpOnThisHost={mcpOnThisHost} fallbackMcpUrl={fallbackMcpUrl} />
        </Suspense>
      </div>
    </Layout>
  );
}
