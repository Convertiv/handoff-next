import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getMergedAdminBuildTasks } from '../../../lib/db/queries';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import BuildsClient from './BuildsClient';

export const metadata: Metadata = {
  title: 'Builds',
  description: 'Component preview builds, design asset extraction, and design-to-component AI jobs',
};

export default async function AdminBuildsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/builds');
  }
  if (session.user.role !== 'admin') {
    return (
      <BuildsClient
        initialTasks={[]}
        config={config}
        menu={menu}
        message="You need administrator access to view this page."
      />
    );
  }

  let tasks: Awaited<ReturnType<typeof getMergedAdminBuildTasks>> = [];
  try {
    tasks = await getMergedAdminBuildTasks(120, 120);
  } catch {
    tasks = [];
  }

  return <BuildsClient initialTasks={tasks} config={config} menu={menu} />;
}
