import { notFound } from 'next/navigation';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { getDbPatternById } from '../../../lib/db/queries';
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

  let isTemplate = false;
  if (isPostgres()) {
    const row = await getDbPatternById(id).catch(() => null);
    if (!row) notFound();
    // Known here, so the editor can open read-only on the first render rather than discovering it after a
    // refused save. See `savePageAsTemplate`: templates are frozen by design.
    isTemplate = row.source === 'template';
  }

  return (
    <PlaygroundClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      initialPatternId={id}
      initialIsTemplate={isTemplate}
    />
  );
}
