import { Metadata } from 'next';
import { Suspense } from 'react';
import { usePostgres } from '../../lib/db/dialect';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Handoff',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
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
      <LoginClient passwordUpdated={sp.reset === '1'} />
    </Suspense>
  );
}
