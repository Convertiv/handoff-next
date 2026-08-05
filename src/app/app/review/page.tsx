import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { isPostgres } from '../../lib/db/dialect';
import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import { listReviewQueue } from '../../lib/db/grant-queries';
import ReviewClient from './ReviewClient';

export const metadata: Metadata = {
  title: 'Review queue',
  description: 'Pages submitted for review',
};

/**
 * The review inbox (docs/GUEST-AUTHORING.md, Slice 2).
 *
 * Gated the same way the admin pages are — a message rather than a 404, so a non-maintainer who follows a
 * link understands why. The endpoints behind it enforce `canApprove` independently, so this gate is for
 * the human, not the security boundary.
 */
export default async function ReviewPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!isPostgres()) {
    return <ReviewClient config={config} menu={menu} message="The review queue requires Postgres (set DATABASE_URL)." />;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/review');
  }
  if (session.user.role !== 'admin') {
    return (
      <ReviewClient
        config={config}
        menu={menu}
        message="You need maintainer access to review submitted pages."
      />
    );
  }

  /**
   * Fetched here rather than from the client on mount: this component is already maintainer-gated and can
   * query directly, so the queue arrives with the first paint. Dates are serialized to ISO strings so the
   * client/server contract is explicit rather than relying on how Dates cross the boundary.
   */
  const submissions = (await listReviewQueue()).map((row) => ({
    ...row,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }));

  return <ReviewClient config={config} menu={menu} initialRows={submissions} />;
}
