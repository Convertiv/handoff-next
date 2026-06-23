import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import { listUsers } from '../../../lib/server/admin-users';
import UsersClient from './UsersClient';

export const metadata: Metadata = {
  title: 'Account Users',
  description: 'Manage Handoff users',
};

export const dynamic = 'force-dynamic';

export default async function AccountUsersPage() {
  if (!usePostgres()) {
    return null;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account/users');
  }
  if (session.user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">You need administrator access to view this page.</p>;
  }

  let initialUsers: Awaited<ReturnType<typeof listUsers>> = [];
  try {
    initialUsers = await listUsers(session);
  } catch {
    initialUsers = [];
  }

  return <UsersClient initialUsers={initialUsers} />;
}
