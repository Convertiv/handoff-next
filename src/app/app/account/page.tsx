import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { usePostgres } from '../../lib/db/dialect';
import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import type { AiEventRow, AiCostByUserRow } from '../../lib/db/queries';
import AccountClient from './AccountClient';

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your profile and workspace settings',
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!usePostgres()) {
    return (
      <AccountClient
        config={config}
        menu={menu}
        user={null}
        aiEvents={[]}
        aiByUser={[]}
        message="Account settings require Postgres (set DATABASE_URL)."
      />
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account');
  }

  const isAdmin = session.user.role === 'admin';

  let aiEvents: AiEventRow[] = [];
  let aiByUser: AiCostByUserRow[] = [];

  if (isAdmin) {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    try {
      const { getAiEventsForRange, getAiCostByUser } = await import('../../lib/db/queries');
      [aiEvents, aiByUser] = await Promise.all([
        getAiEventsForRange({ from, to: now, limit: 200 }),
        getAiCostByUser({ from, to: now }),
      ]);
    } catch {
      // non-fatal
    }
  }

  return (
    <AccountClient
      config={config}
      menu={menu}
      user={{
        id: session.user.id ?? '',
        name: session.user.name ?? '',
        email: session.user.email ?? '',
        image: session.user.image ?? '',
        role: session.user.role ?? 'member',
      }}
      aiEvents={aiEvents}
      aiByUser={aiByUser}
    />
  );
}
