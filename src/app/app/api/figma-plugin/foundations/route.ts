import { NextResponse } from 'next/server';
import { Dtcg } from 'handoff-core';
import { verifyHandoffApiAuth } from '@/lib/mcp-auth';
import { getDataProvider } from '@/lib/data';
import { asDtcgSource } from '@/lib/dtcg-axes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESERVED_PARAMS = new Set(['format']);

/**
 * GET /api/figma-plugin/foundations?brand=&scheme=&… (P1.6c) — resolved foundation
 * slice for pull-to-canvas (a later plugin milestone). Resolves the stored source
 * against a generic axis selector via Dtcg.resolveTokens. Scoped to `figma:sync`.
 * Returns { selector, axes, tokens } (or tokens:null with a note when no source).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = verifyHandoffApiAuth(request, { requireScopes: ['figma:sync'] });
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const selector: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (!RESERVED_PARAMS.has(k) && v !== '') selector[k] = v;
  }

  let source;
  try {
    source = asDtcgSource(await getDataProvider().getDtcgSource());
  } catch {
    source = null;
  }
  if (!source) {
    return NextResponse.json({
      selector,
      axes: [],
      tokens: null,
      note: 'This registry has no reference source tree yet. Commit a Figma foundations sync first.',
    });
  }

  try {
    const tokens = Dtcg.resolveTokens(source, selector);
    return NextResponse.json({ selector, axes: source.axes, tokens });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Resolution failed' }, { status: 422 });
  }
}
