import { NextResponse, type NextRequest } from 'next/server';
import path from 'path';
import { auth } from '@/lib/auth';
import { exportComponentsToFilesystem } from '@/lib/server/component-export';
import { getComponentExportProjectRoot } from '@/lib/server/handoff-config-project';

/** Skip build-time route collection (avoids SQLite auth + parallel worker locks). */
export const dynamic = 'force-dynamic';

const MAX_EXPORT_PER_USER_PER_MINUTE = 10;
const exportPostTimestampsByUser = new Map<string, number[]>();

function pruneAndCountRecent(userId: string, windowMs: number, now: number): number {
  const arr = exportPostTimestampsByUser.get(userId) ?? [];
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  exportPostTimestampsByUser.set(userId, next);
  return next.length;
}

function recordPost(userId: string, now: number): void {
  const arr = exportPostTimestampsByUser.get(userId) ?? [];
  arr.push(now);
  exportPostTimestampsByUser.set(userId, arr);
}

function safeOutputDir(raw: string | undefined): string {
  const root = path.normalize(getComponentExportProjectRoot());
  const rel = (raw?.trim() || 'components').replace(/^\/+/, '');
  const abs = path.isAbsolute(rel) ? path.normalize(rel) : path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new Error('outputDir must be inside the project root (HANDOFF_WORKING_PATH or handoff-app repo)');
  }
  return abs;
}

type ExportBody = {
  componentIds?: string[];
  outputDir?: string;
  autoCommit?: boolean;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = Date.now();
  const userId = session.user.id;
  const recent = pruneAndCountRecent(userId, 60_000, now);
  if (recent >= MAX_EXPORT_PER_USER_PER_MINUTE) {
    return NextResponse.json({ error: 'Too many export requests; try again in a minute.' }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ExportBody;
    const outputDir = safeOutputDir(body.outputDir);
    recordPost(userId, now);
    const result = await exportComponentsToFilesystem({
      outputDir,
      componentIds: body.componentIds,
      autoCommit: body.autoCommit !== false,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
