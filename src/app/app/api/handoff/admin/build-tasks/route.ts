import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isDynamic } from '@/lib/mode';
import { getMergedAdminBuildTasks } from '@/lib/db/queries';

/** Admin-only merged build queue: component Vite jobs + design asset extraction. */
export async function GET() {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const tasks = await getMergedAdminBuildTasks(120, 120);
    return NextResponse.json({ tasks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load build tasks';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
