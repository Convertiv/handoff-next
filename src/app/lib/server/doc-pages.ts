import 'server-only';

import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { getDb } from '../db';
import { handoffPages } from '../db/schema';

export type HandoffPageRow = {
  slug: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function requireSession(session: Session | null): Session {
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session;
}

/** Build `handoff_page.slug` from docs catch-all route segments (path under `pages/` without `.md`). */
export function docsRouteToPageSlug(dirParts: string[], file: string): string {
  return dirParts.length > 0 ? `${dirParts.join('/')}/${file}` : file;
}

export async function getHandoffPageBySlug(slug: string): Promise<HandoffPageRow | null> {
  const db = getDb();
  const [row] = await db.select().from(handoffPages).where(eq(handoffPages.slug, slug)).limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
    markdown: row.markdown ?? '',
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** Normalize DB frontmatter for Layout / metadata (title, description, metaTitle, metaDescription). */
export function normalizePageMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const fm = frontmatter ?? {};
  const title = (fm.title ?? fm.metaTitle ?? 'Documentation') as string;
  const description = (fm.description ?? fm.metaDescription ?? '') as string;
  return {
    ...fm,
    title,
    description,
    metaTitle: (fm.metaTitle ?? fm.title ?? title) as string,
    metaDescription: (fm.metaDescription ?? fm.description ?? description) as string,
  };
}

export async function upsertHandoffPage(
  session: Session | null,
  slug: string,
  frontmatter: Record<string, unknown>,
  markdown: string
): Promise<HandoffPageRow> {
  requireSession(session);
  const db = getDb();

  const trimmedSlug = slug.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlug) throw new Error('Invalid slug');

  await db
    .insert(handoffPages)
    .values({
      slug: trimmedSlug,
      frontmatter,
      markdown,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: handoffPages.slug,
      set: {
        frontmatter,
        markdown,
        updatedAt: new Date(),
      },
    });

  const saved = await getHandoffPageBySlug(trimmedSlug);
  if (!saved) throw new Error('Failed to save page');
  return saved;
}
