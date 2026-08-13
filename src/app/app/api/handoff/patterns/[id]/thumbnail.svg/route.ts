import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { patternThumbnailFromBlocks } from '@/lib/pattern-thumbnail';
import type { PatternComponentEntry } from '@/lib/guest-editable';

/**
 * Schematic thumbnail for a saved page.
 *
 * The library card has always had the picture slot and the pattern row has always had a `thumbnail`
 * column, but nothing on the save path writes one — so every page saved from the playground rendered
 * "No preview" on an empty grey box. Rather than adding a capture pipeline (a headless browser, on a
 * serverless deploy, for a card image), this derives the page's silhouette from the blocks it is
 * already made of. See `patternThumbnailSvg`.
 *
 * **This route is the swap boundary**, exactly as the component one is: callers reference the URL, so
 * replacing diagrams with real captures later changes what is served here and touches no caller.
 *
 * **Authorised like the pattern itself.** A silhouette leaks a page's structure, which is not nothing —
 * so this runs the same `computePermissions` check the pattern's own GET does and 404s where that would
 * refuse, rather than serving structure from behind a picture tag.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const patternId = (id ?? '').trim();
  if (!patternId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const row = await getDbPatternById(patternId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const actor: MutateActor = { userId, role: session.user.role ?? null };
  const grant = await getActorGrant('pattern', patternId, userId);
  const { canView } = computePermissions(
    actor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    grant
  );
  // 404 rather than 403: a card image should not confirm that a page exists to someone who cannot see it.
  if (!canView) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  /**
   * Drawn from the page's **own stored content**, with no component lookups (2026-08-13).
   *
   * ⚠️ This route used to fetch each distinct component of the page to read its contract — one query per
   * component, per card, per library render. Fifty cards with six blocks apiece meant roughly 450 queries and
   * fifty session reads hitting a pool of ten, in parallel, every time the tab was opened. That was the library
   * being slow. The page row already carries everything the silhouette needs.
   */
  const entries = Array.isArray(row.components) ? (row.components as PatternComponentEntry[]) : [];
  const overrides = ((row.data as { previews?: { default?: { values?: unknown[] } } })?.previews?.default?.values ??
    []) as unknown[];

  return new Response(patternThumbnailFromBlocks(entries, overrides), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      /**
       * Private, unlike the component thumbnail's shared cache: this one is behind a per-user
       * permission check, and a shared cache would let one viewer's copy be served to someone the check
       * would have refused.
       */
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=86400',
    },
  });
}
