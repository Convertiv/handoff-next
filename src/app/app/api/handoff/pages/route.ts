import { NextResponse, type NextRequest } from 'next/server';
import { getHandoffPageBySlug, listHandoffPages, upsertHandoffPage } from '@/lib/server/doc-pages';

export async function GET(request: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? '';

  // No slug → return all pages as a summary list for the page manager
  if (!slug) {
    try {
      const pages = await listHandoffPages();
      return NextResponse.json({ pages });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
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

    // upsertHandoffPage also fires syncPageToNav (non-fatal, fire-and-forget)
    const saved = await upsertHandoffPage(session, slug, frontmatter, markdown);
    return NextResponse.json(saved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
    const { getDb } = await import('@/lib/db');
    const { handoffPages } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    await db.delete(handoffPages).where(eq(handoffPages.slug, slug));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
