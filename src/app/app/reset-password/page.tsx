import { Metadata } from 'next';
import { Suspense } from 'react';
import { isDynamic } from '../../lib/mode';
import ResetPasswordClient from './ResetPasswordClient';

export const metadata: Metadata = {
  title: 'Reset password',
  description: 'Reset your Handoff password',
};

export default function ResetPasswordPage() {
  if (!isDynamic()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">Password reset is only available in dynamic mode.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
