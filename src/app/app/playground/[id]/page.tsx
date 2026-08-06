import { notFound, redirect } from 'next/navigation';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import {
  getDbPatternById,
  getUserDisplays,
  listBriefsForPage,
  listBuildsForPage,
  listTemplateSubmissions,
} from '../../../lib/db/queries';
import { listShareLinks } from '../../../lib/db/grant-queries';
import { briefBelongsToPage, findBuild } from '../../../lib/workbench-level';
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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** First value only: `?brief=a&brief=b` is a malformed URL, not a request to open two briefs. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export default async function PlaygroundPageById({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParams;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  const config = getClientRuntimeConfig();

  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  let isTemplate = false;
  let pageTitle = '';
  let initialBriefs: Awaited<ReturnType<typeof listBriefsForPage>> = [];
  let brief: React.ComponentProps<typeof PlaygroundClient>['brief'] = null;
  let build: React.ComponentProps<typeof PlaygroundClient>['build'] = null;
  let pageBuilds: Awaited<ReturnType<typeof listBuildsForPage>> = [];
  if (isPostgres()) {
    const row = await getDbPatternById(id).catch(() => null);
    if (!row) notFound();
    // Known here, so the editor can open read-only on the first render rather than discovering it after a
    // refused save. See `savePageAsTemplate`: templates are frozen by design.
    isTemplate = row.source === 'template';
    pageTitle = row.title ?? '';

    /**
     * A brief is a *level of its parent page*, not a page of its own (roadmap E.8). An old link pointing a
     * brief id at this route is rewritten to the page that owns it with the brief selected, so the URL and the
     * interface agree. Without a parent there is nothing to nest it under, so it 404s rather than opening a
     * frozen record in an editor.
     */
    if (isTemplate) {
      if (!row.sourcePageId) notFound();
      redirect(`${basePath}/playground/${encodeURIComponent(row.sourcePageId)}?brief=${encodeURIComponent(id)}`);
    }
    // Fetched server-side so the invitations dropdown is correct on first paint and nothing sets state from
    // an effect. A brief has no invitations of its own, so only a page asks.
    if (!isTemplate) initialBriefs = await listBriefsForPage(id).catch(() => []);
    // Every build across every brief, so the page can list incoming work without a detour through a brief.
    if (!isTemplate) pageBuilds = await listBuildsForPage(id).catch(() => []);

    /**
     * Resolve the selected brief and build **here**, so the panel has its data on first paint and so the
     * ownership checks below cannot be skipped by a hand-typed URL.
     *
     * Both relationships are verified rather than assumed: a brief must have been snapshotted from *this* page
     * (`sourcePageId`), and a build must have been made from *that* brief (`templateId`). Otherwise
     * `?brief=`/`?build=` would be a way to render any record in the deployment inside your own page's shell.
     * A mismatch drops the selection instead of erroring — the page itself is still a valid thing to show.
     */
    const briefId = one(query.brief);
    if (briefId) {
      const briefRow = await getDbPatternById(briefId).catch(() => null);
      if (briefBelongsToPage(briefRow, id)) {
        const [builds, links, creators] = await Promise.all([
          listTemplateSubmissions(briefRow.id).catch(() => []),
          listShareLinks('pattern', briefRow.id).catch(() => []),
          briefRow.userId ? getUserDisplays([briefRow.userId]).catch(() => new Map()) : Promise.resolve(new Map()),
        ]);
        const briefData = (briefRow.data ?? {}) as { brief?: { instructions?: string } };

        const buildRows = builds.map((b) => ({
          id: b.id,
          title: b.title,
          status: b.status,
          submittedByName: b.submittedByName,
          submittedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
          submittedMessage: b.submittedMessage,
        }));

        brief = {
          meta: {
            id: briefRow.id,
            title: briefRow.title ?? '',
            version: briefRow.briefVersion ?? null,
            description: briefRow.description ?? null,
            instructions: briefData.brief?.instructions ?? null,
            createdAt: briefRow.createdAt ? briefRow.createdAt.toISOString() : null,
            createdByName: (briefRow.userId ? creators.get(briefRow.userId)?.name : null) ?? null,
          },
          links: links.map((l) => ({
            id: l.id,
            writeCapable: l.writeCapable,
            passphraseRequired: l.passphraseRequired,
            secretRecoverable: l.secretRecoverable,
            useCount: l.useCount,
            maxUses: l.maxUses,
            expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
          })),
          builds: buildRows,
        };

        // Only a build belonging to the selected brief; anything else is ignored, not surfaced.
        const buildId = one(query.build);
        if (buildId) build = findBuild(buildRows, buildId);
      }
    }
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
      brief={brief}
      build={build}
      pageBuilds={pageBuilds.map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        submittedByName: b.submittedByName,
        submittedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
        submittedMessage: b.submittedMessage,
        briefId: b.briefId,
        briefLabel: b.briefVersion ? `v${b.briefVersion}` : null,
      }))}
    />
  );
}
