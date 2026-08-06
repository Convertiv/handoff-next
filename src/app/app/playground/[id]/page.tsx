import { notFound, redirect } from 'next/navigation';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { getDbPatternById, listBriefsForPage } from '../../../lib/db/queries';
import { isPostgres } from '../../../lib/db/dialect';
import PlaygroundClient from '../PlaygroundClient';

/**
 * A saved page at its own URL — roadmap E.3.
 *
 * `/playground/{id}` is the page as a *document*: linkable, bookmarkable, and the thing autosave writes to.
 * `/playground` stays the clean canvas for something new. The `?pattern=` query form still works (nothing
 * that links to it breaks), but this is the shape to prefer.
 *
 * The record is checked here rather than after hydration so a bad id is a 404 instead of an empty canvas
 * that silently discards whatever the user then types into it.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  const row = isPostgres() ? await getDbPatternById(id).catch(() => null) : null;
  return {
    title: row?.title ? `${row.title} — Playground` : props.metadata.metaTitle,
    description: props.metadata.metaDescription,
  };
}

export default async function PlaygroundPageById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  const config = getClientRuntimeConfig();

  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  let isTemplate = false;
  let pageTitle = '';
  let initialBriefs: Awaited<ReturnType<typeof listBriefsForPage>> = [];
  if (isPostgres()) {
    const row = await getDbPatternById(id).catch(() => null);
    if (!row) notFound();
    // Known here, so the editor can open read-only on the first render rather than discovering it after a
    // refused save. See `savePageAsTemplate`: templates are frozen by design.
    isTemplate = row.source === 'template';
    pageTitle = row.title ?? '';

    // A brief has its own surface; anything still pointing here is sent there rather than 404ing.
    if (isTemplate) redirect(`${basePath}/briefs/${encodeURIComponent(id)}`);
    // Fetched server-side so the invitations dropdown is correct on first paint and nothing sets state from
    // an effect. A brief has no invitations of its own, so only a page asks.
    if (!isTemplate) initialBriefs = await listBriefsForPage(id).catch(() => []);
  }

  return (
    <PlaygroundClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      initialPatternId={id}
      initialIsTemplate={isTemplate}
      pageTitle={pageTitle}
      initialBriefs={initialBriefs.map((b) => ({
        ...b,
        createdAt: b.createdAt ? b.createdAt.toISOString() : null,
      }))}
    />
  );
}
