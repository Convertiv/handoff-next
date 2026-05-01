import { NextResponse, type NextRequest } from 'next/server';
import { getHandoffPageBySlug, upsertHandoffPage } from '@/lib/server/doc-pages';

export async function GET(request: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? '';
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  }

  try {
    const row = await getHandoffPageBySlug(slug);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      slug?: string;
      frontmatter?: Record<string, unknown>;
      markdown?: string;
    };
    const slug = String(body.slug ?? '').trim();
    const frontmatter = body.frontmatter && typeof body.frontmatter === 'object' ? body.frontmatter : {};
    const markdown = String(body.markdown ?? '');

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const saved = await upsertHandoffPage(session, slug, frontmatter, markdown);
    return NextResponse.json(saved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
