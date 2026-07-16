import { NextResponse } from 'next/server';
import { Dtcg, type Types } from 'handoff-core';
import { verifyHandoffApiAuth } from '@/lib/mcp-auth';
import { getDataProvider } from '@/lib/data';
import { insertDtcgTokenChange, upsertRegistryDtcg } from '@/lib/db/registry-queries';
import { asDtcgSource, buildResolvedBrandsCache } from '@/lib/dtcg-axes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_SOURCE: Types.DtcgSource = { schemaVersion: 1, axes: [], tokens: {} };

/** A commit body's `source` must be a DtcgSource (axes[] + tokens object). */
function isDtcgSource(v: unknown): v is Types.DtcgSource {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as Types.DtcgSource).axes) &&
    typeof (v as Types.DtcgSource).tokens === 'object' &&
    (v as Types.DtcgSource).tokens !== null
  );
}

/**
 * POST /api/figma-plugin/foundations/commit (P1.6c) — phase 2 of the two-phase
 * push. Persists the curated `DtcgSource` (the reference-preserving source of
 * truth, incl. originalId/syncState on leaves) + the team-shared axis mapping,
 * precomputes the resolved brand × scheme `brands` cache for the serving/viz path,
 * and appends a `handoff_token_change` record. Scoped to `figma:sync`.
 *
 * Body: { source: DtcgSource, mapping?: Dtcg.AxisMappingConfig, message?: string }
 * Returns: { ok: true, counts:{added,modified,removed} }
 */
export async function POST(request: Request): Promise<Response> {
  const auth = verifyHandoffApiAuth(request, { requireScopes: ['figma:sync'] });
  if (auth instanceof NextResponse) return auth;

  let body: { source?: unknown; mapping?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isDtcgSource(body.source)) {
    return NextResponse.json({ error: 'Expected { source: DtcgSource } with axes[] and tokens{} in body' }, { status: 400 });
  }
  const source = body.source;
  const mapping = (body.mapping && typeof body.mapping === 'object' && !Array.isArray(body.mapping))
    ? (body.mapping as Record<string, unknown>)
    : undefined;
  const message = typeof body.message === 'string' ? body.message : null;

  // Diff vs the stored source for the change record.
  let prev: Types.DtcgSource = EMPTY_SOURCE;
  try {
    prev = asDtcgSource(await getDataProvider().getDtcgSource()) ?? EMPTY_SOURCE;
  } catch {
    prev = EMPTY_SOURCE;
  }
  const changeset = Dtcg.diffDtcgSource(source, prev);

  // Precompute the resolved brand × scheme cache (serving/viz path — ADR-001).
  const brands = buildResolvedBrandsCache(source) as Record<string, Record<string, unknown>>;

  const userId = auth.userId && auth.userId !== 'service' && auth.userId !== 'workspace' ? auth.userId : null;

  try {
    await upsertRegistryDtcg(
      { dtcgSource: source as unknown as Record<string, unknown>, brands, ...(mapping ? { axisMapping: mapping } : {}) },
      userId
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Commit failed' }, { status: 500 });
  }

  // Append change record — fire-and-forget (never fail the commit).
  try {
    await insertDtcgTokenChange(
      {
        addedKeys: changeset.added.map((e) => e.path),
        modifiedKeys: changeset.modified.map((e) => e.path),
        removedKeys: changeset.removed.map((e) => e.path),
        totalCount: changeset.added.length + changeset.modified.length + changeset.unchanged.length,
      },
      { userId, message }
    );
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    counts: { added: changeset.added.length, modified: changeset.modified.length, removed: changeset.removed.length },
  });
}
