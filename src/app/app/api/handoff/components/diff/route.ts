import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { diffFilesystemVsDatabase } from '@/lib/server/component-diff';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const diffs = await diffFilesystemVsDatabase();
    return NextResponse.json({ diffs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
