import { auth } from '@/lib/auth';
import Layout from '../../components/Layout/Main';
import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import LibraryClient from './LibraryClient';

export const metadata = {
  title: 'Library',
  description: 'Browse and manage every design and pattern in one place.',
};

export default async function LibraryPage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  return (
    <Layout
      config={config as never}
      menu={menu as never}
      current={{ path: '/library', title: 'Library' } as never}
      metadata={
        {
          title: 'Library',
          metaTitle: 'Library',
          description: 'Browse and manage every design and pattern in one place.',
          metaDescription: 'Browse and manage every design and pattern in one place.',
        } as never
      }
      fullBleed={false}
    >
      <LibraryClient isLoggedIn={isLoggedIn} />
    </Layout>
  );
}
