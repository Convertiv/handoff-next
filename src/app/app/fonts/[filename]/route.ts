import { NextResponse } from 'next/server';
import { getRegistryFontFile } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/**
 * GET /fonts/<filename> — serve a pushed font file's bytes.
 *
 * Public (no auth): theme.css @font-face URLs like `url('/fonts/Foo.woff2')`
 * resolve here so component previews and the playground render with the brand
 * font on the hosted registry, where the workspace `fonts/` dir does not exist.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ filename: string }> }): Promise<Response> {
  const { filename } = await ctx.params;
  const safe = (filename || '').replace(/[^\w.\-]/g, '');
  if (!safe || !/\.(woff2|woff|ttf|otf)$/i.test(safe)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const file = await getRegistryFontFile(safe);
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ext = safe.split('.').pop()!.toLowerCase();
    return new Response(new Uint8Array(file.data), {
      headers: {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
