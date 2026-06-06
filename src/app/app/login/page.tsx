import { Metadata } from 'next';
import { Suspense } from 'react';
import { usePostgres } from '../../lib/db/dialect';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Handoff',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; setup?: string }> }) {
  if (!usePostgres()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">
          Sign in requires a hosted Handoff deployment with <code className="rounded bg-muted px-1">DATABASE_URL</code>. Local filesystem-only mode
          has no accounts — use <code className="rounded bg-muted px-1">HANDOFF_CLOUD_URL</code> for team features.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}>
      {sp.setup === '1' && (
        <div className="mx-auto mb-4 max-w-sm rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Registry configured. Sign in with your new admin account.
        </div>
      )}
      <LoginClient passwordUpdated={sp.reset === '1'} />
    </Suspense>
  );
}
