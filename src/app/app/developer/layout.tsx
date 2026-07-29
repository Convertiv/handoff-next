import { getClientRuntimeConfig, SectionLink } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import Layout from '@/components/Layout/Main';

// Developer isn't a config/docs-driven section, so its sidebar structure is
// defined here and passed as `current`. Main.tsx then renders the same
// SidebarProvider + SideNav + SidebarInset shell as Foundations/Design System.
const DEVELOPER_SECTION: SectionLink = {
  title: 'Developer',
  weight: 0,
  path: '/developer',
  subSections: [
    {
      title: 'Developer',
      path: '',
      image: '',
      menu: [
        { title: 'Overview', path: '/developer', image: '', icon: 'layout-dashboard' },
        { title: 'CLI Reference', path: '/developer/cli', image: '', icon: 'code' },
        { title: 'REST API', path: '/developer/api', image: '', icon: 'book-open' },
        { title: 'MCP Tools', path: '/developer/mcp', image: '', icon: 'cpu' },
        { title: 'Push / Pull Guide', path: '/developer/push-pull', image: '', icon: 'git-merge' },
        { title: 'Local Development', path: '/developer/local-setup', image: '', icon: 'laptop' },
      ],
    },
    {
      title: 'Downloads',
      path: '',
      image: '',
      menu: [
        { title: 'openapi.yaml', path: '/openapi.yaml', image: '', icon: 'book-open' },
        { title: 'DTCG tokens (.json)', path: '/api/registry/dtcg/download?format=dtcg', image: '', icon: 'file-json' },
        { title: 'Tailwind tokens (.css)', path: '/api/registry/dtcg/download?format=tailwind', image: '', icon: 'file-code' },
        { title: 'CSS tokens (.zip)', path: '/api/registry/dtcg/download?format=css', image: '', icon: 'braces' },
        { title: 'SCSS tokens (.zip)', path: '/api/registry/dtcg/download?format=scss', image: '', icon: 'file-code' },
        { title: 'Icons (.zip)', path: '/api/registry/icons/download', image: '', icon: 'package' },
      ],
    },
  ],
};

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
    <Layout config={config} menu={menu} current={DEVELOPER_SECTION} metadata={meta}>
      {children}
    </Layout>
  );
}
