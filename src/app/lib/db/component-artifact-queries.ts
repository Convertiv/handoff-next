import { and, eq } from 'drizzle-orm';
import { getDb } from './index';
import { componentArtifacts } from './schema';

const SHARED_COMPONENT_ID = '__shared__';
const SHARED_FILENAMES = new Set(['main.css', 'shared.css', 'main.js']);

function contentTypeForFilename(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'text/plain; charset=utf-8';
}

function isBinaryContentType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function artifactComponentIdForFilename(filename: string, defaultComponentId: string): string {
  if (SHARED_FILENAMES.has(filename)) return SHARED_COMPONENT_ID;
  return defaultComponentId;
}

export async function upsertComponentArtifacts(
  componentId: string,
  files: Record<string, string>
): Promise<void> {
  const db = getDb();
  const now = new Date();

  for (const [filename, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    const ownerId = artifactComponentIdForFilename(filename, componentId);
    const contentType = contentTypeForFilename(filename);
    await db
      .insert(componentArtifacts)
      .values({
        componentId: ownerId,
        filename,
        content,
        contentType,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [componentArtifacts.componentId, componentArtifacts.filename],
        set: { content, contentType, updatedAt: now },
      });
  }
}

export async function getComponentArtifactByFilename(filename: string): Promise<{
  content: string;
  contentType: string;
} | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(componentArtifacts)
    .where(eq(componentArtifacts.filename, filename))
    .limit(1);
  if (!row) return null;
  return { content: row.content, contentType: row.contentType };
}

/**
 * Lookup an artifact by (componentId, basename) — used by the catch-all
 * `/api/component/<id>/<file>` route when the URL carries the component id
 * as a path segment rather than baked into the filename prefix. Without this
 * pairing, files pushed under a basename (e.g. `screenshot.png`) are
 * unreachable because the route's earlier "by-filename" lookup searches for
 * the full `${id}/${file}` string and never matches the stored basename.
 */
export async function getComponentArtifactByComponentAndFilename(
  componentId: string,
  filename: string
): Promise<{ content: string; contentType: string } | null> {
  const db = getDb();
  const ownerId = artifactComponentIdForFilename(filename, componentId);
  const [row] = await db
    .select()
    .from(componentArtifacts)
    .where(and(eq(componentArtifacts.componentId, ownerId), eq(componentArtifacts.filename, filename)))
    .limit(1);
  if (!row) return null;
  return { content: row.content, contentType: row.contentType };
}

export async function deleteComponentArtifacts(componentId: string): Promise<void> {
  const db = getDb();
  await db.delete(componentArtifacts).where(eq(componentArtifacts.componentId, componentId));
}

export { isBinaryContentType, SHARED_COMPONENT_ID };
