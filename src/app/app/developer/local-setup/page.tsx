import { Metadata } from 'next';
import { Suspense } from 'react';
import { usePostgres } from '@/lib/db/dialect';
import LocalSetupClient from '../../dev/local-setup/LocalSetupClient';

export const metadata: Metadata = {
  title: 'Local Development',
  description: 'CLI sync, device login, and MCP setup for Cursor and Claude',
};

export default async function LocalDevelopmentPage() {
  const mcpOnThisHost = usePostgres();
  const fallbackMcpUrl =
    process.env.HANDOFF_CLOUD_URL?.trim().replace(/\/$/, '') ||
    process.env.HANDOFF_SYNC_URL?.trim().replace(/\/$/, '') ||
    '';

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Local Development</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          Connect the CLI for sync, then add Handoff MCP in Cursor or Claude Desktop using the same login token.
        </p>
        {!mcpOnThisHost && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-100">
            This instance has no local database. Set <code className="rounded bg-amber-100 px-1 font-mono text-xs dark:bg-amber-900">HANDOFF_CLOUD_URL</code> in your project{' '}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs dark:bg-amber-900">.env</code> to point at a hosted Postgres team instance, then use the steps below.
          </p>
        )}
      </div>
      <Suspense fallback={<p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}>
        <LocalSetupClient mcpOnThisHost={mcpOnThisHost} fallbackMcpUrl={fallbackMcpUrl} />
      </Suspense>
    </div>
  );
}
