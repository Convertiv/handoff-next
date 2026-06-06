import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { usePostgres } from '../../lib/db/dialect';
import { getUserCount } from '../../lib/db/queries';
import SetupClient from './SetupClient';

export const metadata: Metadata = {
  title: 'Set up your registry — Handoff',
};

export default async function SetupPage() {
  // Workspace mode — no setup needed
  if (!usePostgres()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Setup is only available in registry mode (<code className="rounded bg-muted px-1">DATABASE_URL</code> required).
        </p>
      </div>
    );
  }

  // Already configured — send to login
  const userCount = await getUserCount().catch(() => 0);
  if (userCount > 0) redirect('/login');

  return <SetupClient />;
}
