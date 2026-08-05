import { NextResponse, type NextRequest } from 'next/server';
import { canGuestUseAssetLibrary } from '@/lib/authz/policy';
import { summarizeAssetRow } from '@/lib/asset-search';
import { listAssets } from '@/lib/db/queries';
import { readGuestContext } from '@/lib/server/guest-context';

/**
 * The asset library, read-only, for a guest authoring session.
 *
 * Guests fill image slots from what already exists — there is no generation capability at all (Brad,
 * 2026-08-05), so this route is the *only* way imagery enters a guest's page.
 *
 * A separate route rather than a guest branch inside `/api/handoff/assets` on purpose: that endpoint
 * also writes (POST creates assets) and returns whole rows. Everything here is narrowed instead —
 * `summarizeAssetRow`'s presentational subset, active assets only, a hard page cap — so a widening of
 * the authenticated endpoint can't quietly widen what an unauthenticated URL exposes.
 */

/** Hard cap regardless of what the caller asks for: this is an unauthenticated, paged browse. */
const MAX_LIMIT = 60;

export async function GET(request: NextRequest) {
  const linkId = request.nextUrl.searchParams.get('link')?.trim() ?? '';
  const ctx = linkId ? await readGuestContext(linkId) : null;
  if (!ctx) {
    return NextResponse.json({ error: 'This session is no longer valid. Open the link again.' }, { status: 401 });
  }
  if (!canGuestUseAssetLibrary(ctx.guest)) {
    return NextResponse.json({ error: 'This link does not include the asset library.' }, { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const requested = p.get('limit') ? Number(p.get('limit')) : MAX_LIMIT;
  const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.trunc(requested)), MAX_LIMIT) : MAX_LIMIT;
  const offsetRaw = p.get('offset') ? Number(p.get('offset')) : 0;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

  // Only image-ish types are useful in a page slot, and only `active` ones are safe to show — `pending`
  // rows are mid-ingest and may not have bytes yet.
  const assetType = p.get('assetType') === 'logo' ? 'logo' : 'image';

  const rows = await listAssets({
    assetType,
    status: 'active',
    search: p.get('search')?.trim() || undefined,
    limit,
    offset,
  });

  const assets = (rows as Record<string, unknown>[]).map(summarizeAssetRow);
  return NextResponse.json({ assets, limit, offset });
}
