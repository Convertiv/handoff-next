import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { listRegistryFonts, upsertRegistryFonts, type RegistryFontInput } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_FORMATS = new Set(['woff2', 'woff', 'ttf', 'otf']);

/** GET /api/registry/fonts — list font metadata (no bytes). */
export async function GET(): Promise<Response> {
  try {
    const fonts = await listRegistryFonts();
    return NextResponse.json({ fonts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error', fonts: [] }, { status: 500 });
  }
}

/**
 * POST /api/registry/fonts — bulk upsert font files. Requires sync:write.
 * Body: { fonts: Array<{ filename, familyKey, family, weight, style, format, data(base64) }> }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { fonts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.fonts)) {
    return NextResponse.json({ error: 'Expected { fonts: [...] }' }, { status: 400 });
  }

  const valid: RegistryFontInput[] = [];
  for (const raw of body.fonts) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const filename = typeof f.filename === 'string' ? f.filename.trim() : '';
    const data = typeof f.data === 'string' ? f.data : '';
    const format = (typeof f.format === 'string' ? f.format : '').toLowerCase();
    if (!filename || !data || !ALLOWED_FORMATS.has(format)) continue;
    valid.push({
      filename,
      familyKey: typeof f.familyKey === 'string' ? f.familyKey : '',
      family: typeof f.family === 'string' ? f.family : '',
      weight: Number.isFinite(Number(f.weight)) ? Number(f.weight) : 400,
      style: f.style === 'italic' ? 'italic' : 'normal',
      format,
      data,
    });
  }

  if (!valid.length) {
    return NextResponse.json({ error: 'No valid font entries (need filename, data, and a woff2/woff/ttf/otf format).' }, { status: 400 });
  }

  try {
    const count = await upsertRegistryFonts(valid, authz.userId);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
