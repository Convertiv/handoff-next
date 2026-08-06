import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDbPatternById, listTemplateSubmissions } from '../../../lib/db/queries';
import { isPostgres } from '../../../lib/db/dialect';
import BriefViewer from '../../../components/Brief/BriefViewer';

/**
 * A build brief and the pages built from it (`docs/INVITE-TO-BUILD.md`, surfaces 2 and 3).
 *
 * Its own route, not `/playground/{id}`, for two reasons: a brief is a distinct object from a page, and the
 * shared `/playground` path made this surface indistinguishable from an editable one — which is how the global
 * design-system assistant ended up rendering on a read-only review screen.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = isPostgres() ? await getDbPatternById(id).catch(() => null) : null;
  return { title: row?.title ? `${row.title} — Invitation` : 'Invitation', robots: { index: false } };
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  if (!isPostgres()) notFound();

  const row = await getDbPatternById(id).catch(() => null);
  // Only a brief belongs here. A page id would otherwise render a viewer with no invitation to show.
  if (!row || row.source !== 'template') notFound();

  const data = (row.data ?? {}) as { brief?: { instructions?: string } };
  const built = await listTemplateSubmissions(row.id).catch(() => []);

  return (
    <BriefViewer
      basePath={basePath}
      brief={{
        id: row.id,
        title: row.title ?? '',
        version: row.briefVersion ?? null,
        description: row.description ?? null,
        instructions: data.brief?.instructions ?? null,
        sourcePageId: row.sourcePageId ?? null,
      }}
      built={built.map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        submittedByName: b.submittedByName,
        submittedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
        submittedMessage: b.submittedMessage,
      }))}
    />
  );
}
