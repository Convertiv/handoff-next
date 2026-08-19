import { redirect } from 'next/navigation';
import { getClientRuntimeConfig, SectionLink } from '../../components/util';
import Layout from '../../components/Layout/Main';
import { getDataProvider } from '../../lib/data';
import { auth } from '../../lib/auth';
import { isPostgres } from '../../lib/db/dialect';

export const dynamic = 'force-dynamic';

// Account isn't a config/docs-driven section, so its sidebar structure is
// defined here and passed as `current` — same approach as the developer
// section. Main.tsx renders the shared SidebarProvider + SideNav +
// SidebarInset shell used by Foundations/Design System.
const accountSection = (isAdmin: boolean): SectionLink => {
  const groups = [
    {
      title: 'Account',
      items: [
        { title: 'Profile', path: '/account', icon: 'user-circle', adminOnly: false },
        { title: 'Integrations', path: '/account/integrations', icon: 'plug', adminOnly: true },
      ],
    },
    {
      title: 'Workspace',
      items: [
        { title: 'Users', path: '/account/users', icon: 'users', adminOnly: true },
        { title: 'Appearance', path: '/account/appearance', icon: 'paintbrush', adminOnly: true },
        { title: 'Site Protection', path: '/admin/protection', icon: 'lock', adminOnly: true },
        { title: 'AI Cost', path: '/account/ai-cost', icon: 'bot', adminOnly: true },
      ],
    },
    {
      title: 'Tools',
      items: [
        { title: 'Page Manager', path: '/admin/pages', icon: 'file-text', adminOnly: false },
        { title: 'Builds', path: '/admin/builds', icon: 'hammer', adminOnly: true },
        { title: 'Developer Documentation', path: '/developer', icon: 'book-open', adminOnly: false },
      ],
    },
  ];

  return {
    title: 'Account',
    weight: 0,
    path: '/account',
    subSections: groups
      .map((group) => ({
        title: group.title,
        path: '',
        image: '',
        menu: group.items
          .filter((item) => !item.adminOnly || isAdmin)
          .map(({ title, path, icon }) => ({ title, path, icon, image: '' })),
      }))
      .filter((group) => group.menu.length > 0),
  };
};

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const meta = { metaTitle: 'Account', metaDescription: 'Manage your profile and workspace settings' };

  if (!isPostgres()) {
    return (
      <Layout config={config} menu={menu} current={null} metadata={meta}>
        <p className="text-sm text-muted-foreground">Account settings require Postgres (set DATABASE_URL).</p>
      </Layout>
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account');
  }

  return (
    <Layout config={config} menu={menu} current={accountSection(session.user.role === 'admin')} metadata={meta}>
      <div className="mx-auto w-full max-w-4xl space-y-8">{children}</div>
    </Layout>
  );
}
