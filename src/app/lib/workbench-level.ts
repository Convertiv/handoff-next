/**
 * Which level of a page the workbench is showing, and whether the ids in the URL are allowed to say so
 * (roadmap E.8).
 *
 * Pure and shared by the server route (which resolves the records) and the client shell (which picks the
 * panel), so there is exactly one definition of "this brief belongs to this page". Without these checks
 * `?brief=`/`?build=` would be a way to render *any* record in the deployment inside your own page's shell —
 * the records are fetched by id, and nothing else in the request establishes a relationship.
 */

export type WorkbenchLevel = 'page' | 'build';

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
 * Two levels, not three (reflow R.5).
 *
 * There was a `brief` level between these, and it is gone with the briefs themselves. What survives is the rule
 * that mattered: the *server* decides whether a build id may appear inside this page's shell, by
 * `submissionBelongsToTemplate`, and by the time this is called that is already settled.
 */
export function levelFor(hasBuild: boolean): WorkbenchLevel {
  return hasBuild ? 'build' : 'page';
}
