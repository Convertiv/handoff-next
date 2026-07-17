import { NextResponse } from 'next/server';
import { Dtcg, type Types } from 'handoff-core';
import { verifyHandoffApiAuth } from '@/lib/mcp-auth';
import { getDataProvider } from '@/lib/data';
import { getAxisMappingConfig } from '@/lib/db/registry-queries';
import { asDtcgSource } from '@/lib/dtcg-axes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_SOURCE: Types.DtcgSource = { schemaVersion: 1, axes: [], tokens: {} };

/**
 * POST /api/figma-plugin/foundations/preview (P1.6c) — phase 1 of the two-phase
 * push. Ingests a faithful `FigmaFoundationsSnapshot` into a reference-preserving
 * DTCG source (server-side; no mapping logic in the plugin), diffs it against the
 * stored source, and returns the changeset + diagnostics for the curate UI.
 * **No writes.** Scoped to `figma:sync`.
 *
 * Body: FoundationsRequest { snapshot: FigmaFoundationsSnapshot, mapping: Dtcg.AxisMappingConfig }
 *   — mapping is the sole curation surface; falls back to the team-saved config if omitted.
 * Returns FoundationsPreviewResponse:
 *   { changeset: Dtcg.DtcgChangeset (added/modified/removed/unchanged + `next` with
 *     syncState stamped — the source tree, references preserved, axes on next.axes),
 *     diagnostics: Types.Diagnostic[] }
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

  // Mapping: request body wins; else the team-saved config.
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

  let built: { source: Types.DtcgSource; diagnostics: Types.Diagnostic[] };
  try {
    built = Dtcg.buildDtcgSourceFromFigmaSnapshot(body.snapshot as Types.FigmaFoundationsSnapshot, mapping);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Snapshot ingest failed' }, { status: 422 });
  }

  let prev: Types.DtcgSource = EMPTY_SOURCE;
  try {
    prev = asDtcgSource(await getDataProvider().getDtcgSource()) ?? EMPTY_SOURCE;
  } catch {
    prev = EMPTY_SOURCE;
  }

  const changeset = Dtcg.diffDtcgSource(built.source, prev);
  return NextResponse.json({ changeset, diagnostics: built.diagnostics });
}
