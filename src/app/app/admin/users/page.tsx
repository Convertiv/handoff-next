import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import { listUsers } from '../../../lib/server/admin-users';
import UsersClient from './UsersClient';

export const metadata: Metadata = {
  title: 'Users',
  description: 'Manage Handoff users',
};

export default async function AdminUsersPage() {
  if (!usePostgres()) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">User administration requires Postgres (set DATABASE_URL). Local SQLite mode is single-user.</p>
      </div>
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/users');
  }
  if (session.user.role !== 'admin') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="mt-2 text-muted-foreground">You need administrator access to view this page.</p>
      </div>
    );
  }

  let initialUsers: Awaited<ReturnType<typeof listUsers>> = [];
  try {
    initialUsers = await listUsers(session);
  } catch {
    initialUsers = [];
  }

  return <UsersClient initialUsers={initialUsers} />;
}
