import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '../../components/util';
import Layout from '../../components/Layout/Main';
import { getDataProvider } from '../../lib/data';
import { auth } from '../../lib/auth';
import { usePostgres } from '../../lib/db/dialect';
import AccountLayoutClient from './AccountLayoutClient';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!usePostgres()) {
    return (
      <Layout
        config={config}
        menu={menu}
        current={null}
        metadata={{ metaTitle: 'Account', metaDescription: 'Manage your profile and workspace settings' }}
      >
        <p className="text-sm text-muted-foreground">Account settings require Postgres (set DATABASE_URL).</p>
      </Layout>
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account');
  }

  return (
    <AccountLayoutClient config={config} menu={menu} isAdmin={session.user.role === 'admin'}>
      {children}
    </AccountLayoutClient>
  );
}
