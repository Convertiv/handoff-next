import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { getActorGrant } from '@/lib/db/grant-queries';
import { getDbPatternById } from '@/lib/db/queries';
import { getDataProvider } from '@/lib/data';
import { buildPageManifest, manifestToMarkdown } from '@/lib/page-manifest';
import { cmsMigrationPrompt, toCmsTarget } from '@/lib/cms-migration-prompt';
import type { PatternComponentEntry } from '@/lib/guest-editable';

/**
 * A page's content, in the three forms it is actually wanted in (reflow R.6).
 *
 * - `?format=json` — the manifest, for anything programmatic.
 * - `?format=markdown` — the same thing to read: what you hand a brand or legal reviewer, who should not have
 *   to click through a canvas to find the copy.
 * - `?format=prompt` — the manifest wrapped in "move this into the CMS" instructions, to paste into an agent
 *   holding the target's MCP. Add `&target=hubspot|sanity` when you know which.
 *
 * One route rather than three because they are one artifact rendered three ways, and splitting them would be
 * three places that could disagree about what the content of a page is.
 *
 * **Read-only, and authorised like the page itself.** This hands over every word on a page in one response, so
 * it runs the same `computePermissions` check the page's own GET does and 404s where that would refuse — a
 * convenient export is exactly the sort of endpoint that quietly becomes the loosest door in the building.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const pageId = (id ?? '').trim();
  if (!pageId) return NextResponse.json({ error: 'A page id is required.' }, { status: 400 });

  const row = await getDbPatternById(pageId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const actor: MutateActor = { userId, role: session.user.role ?? null };
  const grant = await getActorGrant('pattern', pageId, userId);
  const { canView } = computePermissions(
    actor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    grant
  );
  // 404 rather than 403: an export endpoint should not confirm a page exists to someone who cannot read it.
  if (!canView) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const blocks = (Array.isArray(row.components) ? row.components : []) as PatternComponentEntry[];
  const overrides = ((row.data as { previews?: { default?: { values?: unknown[] } } })?.previews?.default?.values ??
    []) as unknown[];

  /**
   * Component titles, so a block reads as "Hero" rather than as `hero_split_v2`.
   *
   * Best effort: a catalog that cannot be reached leaves every block named by its id, which is honest and still
   * usable. It is not worth failing an export over a nicety.
   */
  let titles: Record<string, string> = {};
  try {
    const components = await getDataProvider().getComponents();
    titles = Object.fromEntries(
      (components as { id?: string; title?: string }[])
        .filter((c) => c?.id && c?.title)
        .map((c) => [c.id!, c.title!])
    );
  } catch {
    titles = {};
  }

  const manifest = {
    ...buildPageManifest({
      pageId: row.id,
      title: row.title ?? '',
      description: row.description ?? null,
      blocks,
      overrides,
      titles,
    }),
    // Stamped here rather than inside the builder, which never reads the clock — same rule the workflow
    // scripts follow, and it keeps the builder's output comparable between runs.
    generatedAt: new Date().toISOString(),
  };

  const format = request.nextUrl.searchParams.get('format') ?? 'json';

  if (format === 'prompt') {
    const target = toCmsTarget(request.nextUrl.searchParams.get('target'));
    return new Response(cmsMigrationPrompt(manifest, target), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }

  if (format === 'markdown') {
    return new Response(manifestToMarkdown(manifest), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }

  return NextResponse.json({ manifest }, { headers: { 'Cache-Control': 'private, no-store' } });
}
