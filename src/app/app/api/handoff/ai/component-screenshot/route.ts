import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isDynamic } from '@/lib/mode';
import {
  captureComponentPreviewPng,
  originFromRequestHeaders,
  sanitizeComponentPreviewPath,
} from '@/lib/server/component-preview-screenshot';

export async function GET(request: NextRequest) {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get('url');
  if (!raw?.trim()) {
    return NextResponse.json({ error: 'Missing url query parameter' }, { status: 400 });
  }

  const previewPath = sanitizeComponentPreviewPath(raw);
  if (!previewPath) {
    return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 });
  }

  const origin = originFromRequestHeaders(request.headers);

  try {
    const png = await captureComponentPreviewPng(origin, previewPath);
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=120',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Screenshot failed';
    const hint =
      'Ensure Chromium is installed (run `npm run playwright:install`) and the preview HTML is reachable from this server.';
    console.error('[component-screenshot]', msg, e);
    return NextResponse.json({ error: `${msg}. ${hint}` }, { status: 502 });
  }
}
