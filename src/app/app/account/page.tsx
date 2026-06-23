import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { usePostgres } from '../../lib/db/dialect';
import AccountClient from './AccountClient';

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your profile and workspace settings',
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  if (!usePostgres()) {
    return null;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account');
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details and avatar.</p>
      </div>
      <AccountClient
        user={{
          id: session.user.id ?? '',
          name: session.user.name ?? '',
          email: session.user.email ?? '',
          image: session.user.image ?? '',
          role: session.user.role ?? 'member',
        }}
      />
    </>
  );
}
