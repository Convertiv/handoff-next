import { NextResponse, type NextRequest } from 'next/server';
import { getImageSlotsForComponent } from '@/lib/db/registry-queries';
import { usePostgres } from '@/lib/db/dialect';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  if (!usePostgres()) return NextResponse.json({ slots: [] });

  const componentId = request.nextUrl.searchParams.get('componentId');
  if (!componentId) {
    return NextResponse.json({ error: 'componentId is required' }, { status: 400 });
  }

  try {
    const slots = await getImageSlotsForComponent(componentId);
    return NextResponse.json({ slots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch image slots' },
      { status: 500 },
    );
  }
}
