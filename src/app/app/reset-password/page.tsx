import { Metadata } from 'next';
import { Suspense } from 'react';
import { usePostgres } from '../../lib/db/dialect';
import ResetPasswordClient from './ResetPasswordClient';

export const metadata: Metadata = {
  title: 'Reset password',
  description: 'Reset your Handoff password',
};

export default function ResetPasswordPage() {
  if (!usePostgres()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">Password reset requires a Postgres-backed deployment (set DATABASE_URL).</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
