import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getComponentExportProjectRoot,
  loadHandoffConfigFromDir,
  resolveComponentEntryDirsAt,
} from '@/lib/server/handoff-config-project';

/** Skip build-time route collection (avoids SQLite auth + parallel worker locks). */
export const dynamic = 'force-dynamic';

/**
 * Component entry directories from `handoff.config` `entries.components`,
 * resolved against `HANDOFF_WORKING_PATH` (when set) or the handoff-app repo root.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const projectRoot = getComponentExportProjectRoot();
    const loaded = loadHandoffConfigFromDir(projectRoot);
    const relative = loaded?.config?.entries?.components ?? [];
    const absolute = resolveComponentEntryDirsAt(loaded?.config ?? null, projectRoot);
    const dirs = relative.map((rel, i) => ({
      relative: rel.replace(/^\/+/, ''),
      absolute: absolute[i]!,
    }));
    return NextResponse.json({ projectRoot, dirs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
