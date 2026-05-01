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
          Sign in is only available when the app uses a team database. Set <code className="rounded bg-muted px-1">DATABASE_URL</code> for Postgres
          (local solo dev uses embedded SQLite without accounts).
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
