import { notFound, redirect } from 'next/navigation';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import {
  getDbPatternById,
  getUserDisplays,
  listBuildsForPage,
  listTemplateSubmissions,
} from '../../../lib/db/queries';
import { getActorGrant, listShareLinks } from '../../../lib/db/grant-queries';
import { auth } from '../../../lib/auth';
import { computePermissions, toVisibility, type MutateActor } from '../../../lib/authz/policy';
import { submissionBelongsToTemplate } from '../../../lib/workbench-level';
import { auditBuild } from '../../../lib/build-audits';
import { advisoryFindings } from '../../../lib/authoring-guardrails';
import { checkPatternGuardrails } from '../../../lib/db/pattern-write';
import { getDb } from '../../../lib/db/index';
import type { PatternComponentEntry } from '../../../lib/guest-editable';
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

/** First value only: `?build=a&build=b` is a malformed URL, not a request to open two pages. */
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
  let build: React.ComponentProps<typeof PlaygroundClient>['build'] = null;
  let pageBuilds: Awaited<ReturnType<typeof listBuildsForPage>> = [];
  let audits: React.ComponentProps<typeof PlaygroundClient>['audits'] = [];
  let guardrailFindings: React.ComponentProps<typeof PlaygroundClient>['guardrailFindings'] = [];
  /**
   * May the person looking at a submitted page **edit it in place** (reflow R.4)?
   *
   * Decided here, on the record, by the same `computePermissions` the write core enforces with — so the canvas
   * cannot offer an affordance whose write would be refused. That is the failure this project has hit twice
   * already: a control that misreports what it can do reads as the feature being broken.
   *
   * It is the ordinary permission, not a new concept: the owner and an admin get it, a teammate who can only
   * view does not.
   */
  let buildCanEdit = false;
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
    /**
     * May this viewer edit the submitted page in place?
     *
     * One helper for both resolution paths, taking the row it just fetched — the alternative was two copies of
     * a permission check, which is the exact shape of the last three bugs in this reflow.
     */
    const canEditSubmission = async (row: { id: string; userId: string | null; visibility: string }) => {
      const session = await auth();
      if (!session?.user) return false;
      const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
      const actor: MutateActor = { userId, role: session.user.role ?? null };
      const grant = await getActorGrant('pattern', row.id, userId);
      return computePermissions(
        actor,
        { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
        grant
      ).canEdit;
    };

    /**
     * **A submitted page opens directly from the template it came from** (reflow R.4).
     *
     * The brief hop is gone for anything built the new way: the share link points at the template, so the
     * page's own provenance is what entitles it to appear inside this shell. Resolved before the legacy branch
     * so a new-model page never needs `?brief=` — and, like that branch, verified rather than assumed.
     */
    const directBuildId = one(query.build);
    if (directBuildId && !one(query.brief)) {
      const submission = await getDbPatternById(directBuildId).catch(() => null);
      if (submissionBelongsToTemplate(submission, id)) {
        /**
         * Name and note come from the list this route already fetched, which computes them from the guest's
         * own change record. Enrichment only — the gate is the provenance check above, because that list is
         * capped and a template with more submissions than the cap must not lose access to the newest ones.
         */
        const listed = pageBuilds.find((b) => b.id === submission!.id) ?? null;
        build = {
          id: submission!.id,
          title: submission!.title ?? '',
          status: submission!.status ?? '',
          submittedByName: listed?.submittedByName ?? null,
          submittedAt: submission!.updatedAt ? submission!.updatedAt.toISOString() : null,
          submittedMessage: listed?.submittedMessage ?? null,
        };
        // The same two passes the legacy branch runs, on the same record — see the note there.
        const blocks = (Array.isArray(submission!.components) ? submission!.components : []) as PatternComponentEntry[];
        const values =
          ((submission!.data as { previews?: { default?: { values?: unknown[] } } })?.previews?.default?.values ??
            []) as unknown[];
        audits = auditBuild(blocks, values);
        guardrailFindings = advisoryFindings(await checkPatternGuardrails(getDb(), submission!.id));
        buildCanEdit = await canEditSubmission(submission!);
      }
    }

    /**
     * `?brief=` is no longer resolved (reflow R.5).
     *
     * Briefs are retired: migration 0030 repointed every page that came through one and archived the rows.
     * An old link carrying both ids still works, because `?build=` resolves on its own above — which is the
     * whole point of having done the collapse before this deletion.
     */
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
      build={build}
      audits={audits}
      guardrailFindings={guardrailFindings}
      buildCanEdit={buildCanEdit}
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
