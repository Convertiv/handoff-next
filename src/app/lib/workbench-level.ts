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
 * `build` wins over `brief`: selecting a build is drilling deeper, not switching sideways. A build without its
 * brief is not a level — it is an inconsistent URL, and it resolves to the brief rather than showing a build
 * with no context to go back to.
 */
export function levelFor(hasBrief: boolean, hasBuild: boolean): WorkbenchLevel {
  if (hasBrief && hasBuild) return 'build';
  if (hasBrief) return 'brief';
  return 'page';
}
