import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import IntegrationsSection from '../IntegrationsSection';

export const metadata: Metadata = {
  title: 'Account Integrations',
  description: 'Manage account integrations',
};

export const dynamic = 'force-dynamic';

export default async function AccountIntegrationsPage() {
  if (!usePostgres()) {
    return null;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account/integrations');
  }

  if (session.user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">You need administrator access to view this page.</p>;
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect and manage external services for this registry.</p>
      </div>
      <IntegrationsSection />
    </>
  );
}
