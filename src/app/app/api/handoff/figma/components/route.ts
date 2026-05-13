import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFigmaAuditApiResponse } from '@/lib/server/figma-sync-service';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const response = await getFigmaAuditApiResponse(session.user.id);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Figma component audit';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
