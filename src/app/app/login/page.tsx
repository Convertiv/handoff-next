import { Metadata } from 'next';
import { Suspense } from 'react';
import { isDynamic } from '../../lib/mode';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Handoff',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (!isDynamic()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">Sign in is only available when the app runs in dynamic mode (HANDOFF_MODE=dynamic).</p>
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
