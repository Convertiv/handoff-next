/**
 * Which level of a page the workbench is showing, and whether the ids in the URL are allowed to say so
 * (roadmap E.8).
 *
 * Pure and shared by the server route (which resolves the records) and the client shell (which picks the
 * panel), so there is exactly one definition of "this brief belongs to this page". Without these checks
 * `?brief=`/`?build=` would be a way to render *any* record in the deployment inside your own page's shell —
 * the records are fetched by id, and nothing else in the request establishes a relationship.
 */

export type WorkbenchLevel = 'page' | 'brief' | 'build';

/** The minimum of a brief row needed to place it. */
export interface BriefRef {
  source: string | null;
  sourcePageId: string | null;
}

/**
 * A brief belongs to a page when it is a brief *and* was snapshotted from that page.
 *
 * Both halves matter: `source === 'template'` stops an ordinary page being nested inside another page as if it
 * were an invitation, and `sourcePageId` is the only thing tying it to *this* page rather than any other.
 */
export function briefBelongsToPage(brief: BriefRef | null | undefined, pageId: string): boolean {
  if (!brief || !pageId) return false;
  return brief.source === 'template' && brief.sourcePageId === pageId;
}

/**
 * A build is selectable only if it is among the builds of the brief already accepted for this page.
 *
 * Membership rather than a `templateId` comparison on purpose: the caller has already listed the brief's
 * builds, so checking against that list cannot drift from what the panel displays — a build you cannot see
 * listed is a build you cannot open.
 */
export function findBuild<T extends { id: string }>(builds: readonly T[], buildId: string): T | null {
  if (!buildId) return null;
  return builds.find((b) => b.id === buildId) ?? null;
}

/**
 * A page built **directly from this template**, with no brief in between (reflow R.4).
 *
 * This is the collapse: under the reflow a share link points at the template itself, so a submitted page's
 * claim on this shell is its own provenance record rather than a chain through a frozen snapshot. The check is
 * the same shape as `briefBelongsToPage` and exists for the same reason — without it, `?build=` would render
 * any record in the deployment inside your page's shell.
 *
 * ⚠️ Reads `provenance.templateId`, **not** `template_id`. The column still points at the brief for legacy
 * rows, and R.0 deliberately staged the new value in JSON so today's review diff kept working; R.5 moves the
 * column. Until then this is where the truth is.
 */
export function submissionBelongsToTemplate(
  submission: { provenance?: unknown } | null | undefined,
  templateId: string
): boolean {
  if (!submission || !templateId) return false;
  const provenance = submission.provenance;
  if (!provenance || typeof provenance !== 'object') return false;
  return (provenance as { templateId?: unknown }).templateId === templateId;
}

/**
 * `build` wins over `brief`: selecting a build is drilling deeper, not switching sideways.
 *
 * **A build no longer needs a brief to be a level** (reflow R.4). It used to: a build without its brief was an
 * inconsistent URL, because the only way to have one was through the other. Now a page can descend directly
 * from a template, so `?build=` alone is a legitimate URL — the *server* decides whether that id is allowed to
 * appear here, by one of the two `…BelongsTo…` checks, and by the time this is called that is already settled.
 */
export function levelFor(hasBrief: boolean, hasBuild: boolean): WorkbenchLevel {
  if (hasBuild) return 'build';
  if (hasBrief) return 'brief';
  return 'page';
}
