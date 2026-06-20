import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import Layout from '@/components/Layout/Main';
import DeveloperSidebar from '@/components/Developer/DeveloperSidebar';

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const meta = {
    metaTitle: 'Developer Docs — Handoff',
    metaDescription: 'CLI reference, REST API, MCP tools, and push/pull guides for Handoff integrations.',
    title: 'Developer Docs',
    description: '',
  };

  return (
    <Layout config={config} menu={menu} current={undefined} metadata={meta}>
      <div className="flex gap-8">
        <DeveloperSidebar />
        <div className="min-w-0 flex-1 py-0">{children}</div>
      </div>
    </Layout>
  );
}
