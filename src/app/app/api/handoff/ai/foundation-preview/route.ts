import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isDynamic } from '@/lib/mode';
import { renderFoundationsImage, shouldRasterizeFoundations } from '@/lib/server/foundation-image';
import type { DesignWorkbenchFoundationContext } from '@/app/design/workbench-types';

type Body = {
  foundationContext?: DesignWorkbenchFoundationContext;
};

export async function POST(request: Request) {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const ctx: DesignWorkbenchFoundationContext = body.foundationContext ?? {
    colors: [],
    typography: [],
    effects: [],
    spacing: [],
  };

  if (!shouldRasterizeFoundations(ctx)) {
    return NextResponse.json({ error: 'No foundation tokens to render' }, { status: 400 });
  }

  try {
    const png = await renderFoundationsImage(ctx);
    if (!png) {
      return NextResponse.json({ error: 'Could not render foundations' }, { status: 500 });
    }
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Render failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
