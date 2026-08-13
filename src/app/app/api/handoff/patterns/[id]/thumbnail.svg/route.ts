import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import { getDbPatternById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { patternThumbnailSvg } from '@/lib/pattern-thumbnail';

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

  const entries = Array.isArray(row.components) ? (row.components as { id?: unknown }[]) : [];

  /**
   * Contracts are fetched once per distinct component, not once per block.
   *
   * A page repeating the same card block eight times would otherwise be eight identical provider reads
   * for one picture.
   */
  const provider = getDataProvider();
  const cache = new Map<string, Record<string, unknown> | null>();
  const blocks: (Record<string, unknown> | null)[] = [];
  for (const entry of entries) {
    const componentId = typeof entry?.id === 'string' ? entry.id : '';
    if (!componentId) {
      blocks.push(null);
      continue;
    }
    if (!cache.has(componentId)) {
      const component = await provider.getComponent(componentId).catch(() => null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cache.set(componentId, ((component as any)?.properties as Record<string, unknown>) ?? null);
    }
    blocks.push(cache.get(componentId) ?? null);
  }

  return new Response(patternThumbnailSvg(blocks), {
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
