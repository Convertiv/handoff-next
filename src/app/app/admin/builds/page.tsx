import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { isDynamic } from '../../../lib/mode';
import { getRecentBuildJobs } from '../../../lib/db/queries';
import { getClientRuntimeConfig, staticBuildMenu } from '../../../components/util';
import BuildsClient from './BuildsClient';

export const metadata: Metadata = {
  title: 'Component Builds',
  description: 'Recent component build jobs',
};

export default async function AdminBuildsPage() {
  const config = getClientRuntimeConfig();
  const menu = staticBuildMenu();

  if (!isDynamic()) {
    return (
      <BuildsClient
        initialJobs={[]}
        config={config}
        menu={menu}
        message="Build dashboard is only available in dynamic mode."
      />
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/builds');
  }
  if (session.user.role !== 'admin') {
    return (
      <BuildsClient
        initialJobs={[]}
        config={config}
        menu={menu}
        message="You need administrator access to view this page."
      />
    );
  }

  let jobs: Awaited<ReturnType<typeof getRecentBuildJobs>> = [];
  try {
    jobs = await getRecentBuildJobs(100);
  } catch {
    jobs = [];
  }

  return <BuildsClient initialJobs={jobs} config={config} menu={menu} />;
}
