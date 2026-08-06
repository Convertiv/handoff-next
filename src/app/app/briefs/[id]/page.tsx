import { notFound, redirect } from 'next/navigation';
import { getDbPatternById } from '../../../lib/db/queries';
import { isPostgres } from '../../../lib/db/dialect';

/**
 * Legacy route — **redirects into the unified shell** (roadmap E.8).
 *
 * A brief used to live here, with its own 30/70 layout, which is precisely why it read as a third product
 * rather than a deeper view of the page it came from ("It makes it unclear what's happening" — Brad,
 * 2026-08-06). It is now `/playground/{pageId}?brief={briefId}`.
 *
 * Kept rather than deleted because links to it already exist — the review queue, anything anyone bookmarked,
 * and any invite follow-up sent before the change.
 */
export const dynamic = 'force-dynamic';

export default async function BriefRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  if (!isPostgres()) notFound();

  const row = await getDbPatternById(id).catch(() => null);
  // Only a brief, and only one that still knows its parent — there is no shell to nest it in otherwise.
  if (!row || row.source !== 'template' || !row.sourcePageId) notFound();

  redirect(`${basePath}/playground/${encodeURIComponent(row.sourcePageId)}?brief=${encodeURIComponent(id)}`);
}
