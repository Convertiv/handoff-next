import { NextResponse } from 'next/server';
import { Dtcg, type Types } from 'handoff-core';
import { verifyHandoffApiAuth } from '@/lib/mcp-auth';
import { getDataProvider } from '@/lib/data';
import { getAxisMappingConfig, insertDtcgTokenChange, upsertRegistryDtcg } from '@/lib/db/registry-queries';
import { asDtcgSource, buildResolvedBrandsCache } from '@/lib/dtcg-axes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_SOURCE: Types.DtcgSource = { schemaVersion: 1, axes: [], tokens: {} };

/**
 * POST /api/figma-plugin/foundations/commit (P1.6, spec §4) — phase 2 of the
 * two-phase push. Takes the SAME body as preview (`{ snapshot, mapping }`) and
 * recomputes the DTCG source deterministically server-side — curation is expressed
 * entirely through `mapping`, so the committed result is a pure function of
 * (snapshot, mapping) and can't be tampered with via a client-serialized tree.
 * Persists the source + team-shared mapping + resolved brands cache, and appends a
 * `handoff_token_change`. Scoped to `figma:sync`. CORS via proxy.ts.
 *
 * Returns FoundationsCommitResponse:
 *   { ok, committedAt, committed: { added, modified, removed } }
 */
export async function POST(request: Request): Promise<Response> {
  const auth = verifyHandoffApiAuth(request, { requireScopes: ['figma:sync'] });
  if (auth instanceof NextResponse) return auth;

  let body: { snapshot?: unknown; mapping?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.snapshot || typeof body.snapshot !== 'object') {
    return NextResponse.json({ error: 'Expected { snapshot: FigmaFoundationsSnapshot } in body' }, { status: 400 });
  }

  // Mapping is the curation surface; body wins, else the team-saved config.
  let mapping = (body.mapping as Dtcg.AxisMappingConfig | undefined) ?? undefined;
  if (!mapping) {
    mapping = ((await getAxisMappingConfig()) as unknown as Dtcg.AxisMappingConfig | null) ?? undefined;
  }
  if (!mapping || !Array.isArray(mapping.axes)) {
    return NextResponse.json(
      { error: 'No axis mapping provided and none saved. Include { mapping: { axes: [{ axis, collection }, …] } }.' },
      { status: 400 }
    );
  }

  // Recompute the source deterministically from (snapshot, mapping).
  let built: { source: Types.DtcgSource; diagnostics: Types.Diagnostic[] };
  try {
    built = Dtcg.buildDtcgSourceFromFigmaSnapshot(body.snapshot as Types.FigmaFoundationsSnapshot, mapping);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Snapshot ingest failed' }, { status: 422 });
  }
  const source = built.source;

  // Diff vs the stored source for the change record + committed counts.
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
      {
        dtcgSource: source as unknown as Record<string, unknown>,
        brands,
        axisMapping: mapping as unknown as Record<string, unknown>,
      },
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
      { userId }
    );
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    committedAt: new Date().toISOString(),
    committed: {
      added: changeset.added.length,
      modified: changeset.modified.length,
      removed: changeset.removed.length,
    },
  });
}
