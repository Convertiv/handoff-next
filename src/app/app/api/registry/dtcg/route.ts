import { NextResponse } from 'next/server';
import { Dtcg } from 'handoff-core';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getRegistryDtcg, upsertRegistryDtcg } from '@/lib/db/registry-queries';
import { getDataProvider } from '@/lib/data';
import { asDtcgSource } from '@/lib/dtcg-axes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reserved query params that are NOT axis selectors. */
const RESERVED_PARAMS = new Set(['format', 'selector']);
const FORMATS = new Set(['css', 'scss', 'map', 'style-dictionary']);

/**
 * GET /api/registry/dtcg
 *
 * Default (no axis params) — returns the full DTCG dist payload, unchanged:
 *   { payload: { manifest, css, scss, tailwind, dtcg, brands, dtcgSource } | null }
 *
 * Axis query (P1.6b) — any generic axis selector (?brand=&scheme=&…) resolves the
 * reference-preserving source tree against that selector via Dtcg.resolveTokens and
 * returns a literal tree (or a formatted string with ?format=css|scss|map|
 * style-dictionary). Unknown axes are ignored; unspecified axes fall to defaults.
 * This is the query/viz path — it does NOT touch the precompiled theme.css bytes.
 *   { selector, axes, tokens }               (JSON tree)
 *   { selector, axes, format, output }        (?format=…)
 *   { selector, axes, tokens: null, note }    (registry has no source tree yet)
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const selector: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (!RESERVED_PARAMS.has(k) && v !== '') selector[k] = v;
    }
    const formatParam = url.searchParams.get('format') ?? undefined;

    // No axis selector → full payload (back-compat).
    if (Object.keys(selector).length === 0 && !formatParam) {
      const payload = await getRegistryDtcg();
      return NextResponse.json({ payload: payload ?? null });
    }

    const source = asDtcgSource(await getDataProvider().getDtcgSource());
    const axes = source?.axes ?? [];
    if (!source) {
      return NextResponse.json({
        selector,
        axes,
        tokens: null,
        note: 'This registry has no reference source tree yet (single-axis/literal). Re-push with references to enable axis queries.',
      });
    }

    if (formatParam) {
      if (!FORMATS.has(formatParam)) {
        return NextResponse.json({ error: `Unknown format "${formatParam}". Use css|scss|map|style-dictionary.` }, { status: 400 });
      }
      const output = Dtcg.resolveAndFormat(source, selector, formatParam as Parameters<typeof Dtcg.resolveAndFormat>[2]);
      return NextResponse.json({ selector, axes, format: formatParam, output });
    }

    const tokens = Dtcg.resolveTokens(source, selector);
    return NextResponse.json({ selector, axes, tokens });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, payload: null }, { status: 500 });
  }
}

/**
 * POST /api/registry/dtcg — upsert the DTCG singleton row.
 * Requires sync:write. Accepts the compiled output of tokens:build.
 *
 * Body shape:
 *   {
 *     manifest: { project, generatedAt, sources, counts },
 *     css:      string  — full tokens.css content
 *     scss:     string  — full _tokens.scss content
 *     tailwind: string  — full tailwind/theme.css content
 *     dtcg:     object  — tokens.resolved.json parsed object
 *   }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: {
    manifest?: unknown;
    css?: unknown;
    scss?: unknown;
    tailwind?: unknown;
    dtcg?: unknown;
    brands?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.manifest || typeof body.manifest !== 'object') {
    return NextResponse.json({ error: 'Expected { manifest: { ... } } in body' }, { status: 400 });
  }
  if (typeof body.css !== 'string' || typeof body.scss !== 'string' || typeof body.tailwind !== 'string') {
    return NextResponse.json({ error: 'Expected css, scss, tailwind as strings in body' }, { status: 400 });
  }
  if (!body.dtcg || typeof body.dtcg !== 'object') {
    return NextResponse.json({ error: 'Expected dtcg as object in body' }, { status: 400 });
  }

  try {
    await upsertRegistryDtcg({
      manifest: body.manifest as Record<string, unknown>,
      css: body.css,
      scss: body.scss,
      tailwind: body.tailwind,
      dtcg: body.dtcg as Record<string, unknown>,
      brands: (body.brands && typeof body.brands === 'object' && !Array.isArray(body.brands))
        ? body.brands as Record<string, Record<string, unknown>>
        : {},
    });
    // NOTE: the DTCG push intentionally does NOT write handoff_tokens_snapshots.
    // That table holds the Figma `localStyles` snapshot the foundation visual
    // displays read (written by POST /api/registry/tokens). Writing a DTCG-shaped
    // row here previously masked the localStyles row and blanked the visuals.
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
