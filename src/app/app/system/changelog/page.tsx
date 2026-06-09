import { Suspense } from 'react';
import HeadersType from '@/components/Typography/Headers';
import { ChangelogClient } from './ChangelogClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Component Changelog',
    description: 'History of component pushes and updates across the design system.',
  };
}

export default async function ChangelogPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <HeadersType.H1>Changelog</HeadersType.H1>
      </div>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading changelog…</div>}>
        <ChangelogClient />
      </Suspense>
    </div>
  );
}
