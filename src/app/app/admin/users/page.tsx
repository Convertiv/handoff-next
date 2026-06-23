import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Users',
  description: 'Manage Handoff users',
};

export default async function AdminUsersPage() {
  redirect('/account/users');
}
