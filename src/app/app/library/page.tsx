import { auth } from '@/lib/auth';
import Layout from '../../components/Layout/Main';
import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import { countReviewQueue } from '../../lib/db/grant-queries';
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

  /**
   * The review queue's size, for maintainers only — counted here rather than fetched on mount, so the
   * badge is correct on first paint and non-maintainers never learn the number. `/review` and its
   * endpoints enforce `canApprove` independently; this only decides whether to show the way in.
   */
  const isMaintainer = session?.user?.role === 'admin';
  const pendingReviews = isMaintainer ? await countReviewQueue().catch(() => 0) : 0;

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
      fullBleed={true}
    >
      <LibraryClient isLoggedIn={isLoggedIn} isMaintainer={isMaintainer} pendingReviews={pendingReviews} />
    </Layout>
  );
}
