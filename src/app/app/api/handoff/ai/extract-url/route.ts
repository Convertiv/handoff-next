import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { extractPage } from '@/lib/server/url-extract';

export const maxDuration = 30;

/**
 * Pull readable content out of a public page so the playground chat has something concrete to compose
 * from — real headings, real copy, the images that exist.
 *
 * Session-gated because it makes the server fetch a URL the user chose. `extractPage` refuses private
 * and link-local addresses for the same reason.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let url = '';
  try {
    const body = (await request.json()) as { url?: string };
    url = typeof body?.url === 'string' ? body.url : '';
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "url" field.' }, { status: 400 });
  }
  if (!url.trim()) return NextResponse.json({ error: 'Enter a URL.' }, { status: 400 });

  try {
    return NextResponse.json(await extractPage(url));
  } catch (e) {
    // These messages are written to be shown as-is: "not reachable from here", "returned a non-HTML
    // response". A generic failure would leave the user guessing whether it was them or us.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read that page.' }, { status: 400 });
  }
}
