import { desc, eq, gte } from 'drizzle-orm';
import { getDb } from './index';
import {
  handoffComponents,
  handoffComponentVersions,
  handoffPageChanges,
  handoffTokenChanges,
} from './schema';
import type { ComponentChangeSummary } from './component-version-queries';

// ─── Unified changelog entry ──────────────────────────────────────────────────

export type ChangelogEntryType = 'component' | 'token' | 'page';

export interface ComponentChangelogEntry {
  id: number;
  entityType: 'component';
  pushedAt: string;
  componentId: string;
  componentTitle: string;
  componentGroup: string;
  versionNumber: number;
  pushedByName: string | null;
  pushedByEmail: string | null;
  trigger: string;
  changeSummary: ComponentChangeSummary;
  message: string | null;
  aiSummary: string | null;
}

export interface TokenChangeDetails {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Record<string, { before: unknown; after: unknown }>;
  truncated?: boolean;
}

export interface TokenChangelogEntry {
  id: number;
  entityType: 'token';
  pushedAt: string;
  trigger: string;
  pushedByName: string | null;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  totalCount: number;
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: string[];
  changeDetails: TokenChangeDetails;
  message: string | null;
  aiSummary: string | null;
}

export interface PageChangelogEntry {
  id: number;
  entityType: 'page';
  pushedAt: string;
  slug: string;
  pageAction: 'created' | 'updated' | 'deleted';
  pushedByName: string | null;
  trigger: string;
  titleBefore: string | null;
  titleAfter: string | null;
  markdownLengthBefore: number | null;
  markdownLengthAfter: number | null;
  message: string | null;
  aiSummary: string | null;
}

export type UnifiedChangelogEntry = ComponentChangelogEntry | TokenChangelogEntry | PageChangelogEntry;

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Returns a unified feed of component, token, and page changes, sorted by
 * pushedAt DESC and capped at `limit`. The three tables are queried separately
 * then merged/sorted client-side.
 */
export async function getUnifiedChangelog(
  limit = 50,
  since?: Date
): Promise<UnifiedChangelogEntry[]> {
  const db = getDb();

  // ── Component versions ──────────────────────────────────────────────────────
  const compRows = await db
    .select({
      id: handoffComponentVersions.id,
      componentId: handoffComponentVersions.componentId,
      versionNumber: handoffComponentVersions.versionNumber,
      pushedAt: handoffComponentVersions.pushedAt,
      pushedByName: handoffComponentVersions.pushedByName,
      pushedByEmail: handoffComponentVersions.pushedByEmail,
      trigger: handoffComponentVersions.trigger,
      changeSummary: handoffComponentVersions.changeSummary,
      message: handoffComponentVersions.message,
      aiSummary: handoffComponentVersions.aiSummary,
      componentTitle: handoffComponents.title,
      componentGroup: handoffComponents.group,
    })
    .from(handoffComponentVersions)
    .leftJoin(handoffComponents, eq(handoffComponentVersions.componentId, handoffComponents.id))
    .where(since ? gte(handoffComponentVersions.pushedAt, since) : undefined)
    .orderBy(desc(handoffComponentVersions.pushedAt))
    .limit(limit);

  // ── Token changes ───────────────────────────────────────────────────────────
  const tokenRows = await db
    .select()
    .from(handoffTokenChanges)
    .where(since ? gte(handoffTokenChanges.pushedAt, since) : undefined)
    .orderBy(desc(handoffTokenChanges.pushedAt))
    .limit(limit);

  // ── Page changes ────────────────────────────────────────────────────────────
  const pageRows = await db
    .select()
    .from(handoffPageChanges)
    .where(since ? gte(handoffPageChanges.pushedAt, since) : undefined)
    .orderBy(desc(handoffPageChanges.pushedAt))
    .limit(limit);

  // ── Merge and sort ──────────────────────────────────────────────────────────
  const all: UnifiedChangelogEntry[] = [];

  for (const r of compRows) {
    all.push({
      id: r.id,
      entityType: 'component',
      pushedAt: (r.pushedAt instanceof Date ? r.pushedAt : new Date(r.pushedAt as string)).toISOString(),
      componentId: r.componentId,
      componentTitle: r.componentTitle ?? r.componentId,
      componentGroup: r.componentGroup ?? '',
      versionNumber: r.versionNumber,
      pushedByName: r.pushedByName,
      pushedByEmail: r.pushedByEmail,
      trigger: r.trigger,
      changeSummary: (r.changeSummary as unknown as ComponentChangeSummary) ?? defaultChangeSummary(),
      message: r.message ?? null,
      aiSummary: r.aiSummary ?? null,
    });
  }

  for (const r of tokenRows) {
    all.push({
      id: r.id,
      entityType: 'token',
      pushedAt: (r.pushedAt instanceof Date ? r.pushedAt : new Date(r.pushedAt as string)).toISOString(),
      trigger: r.trigger,
      pushedByName: r.pushedByName ?? null,
      addedCount: r.addedCount ?? 0,
      removedCount: r.removedCount ?? 0,
      modifiedCount: r.modifiedCount ?? 0,
      totalCount: r.totalCount ?? 0,
      addedKeys: (r.addedKeys as unknown as string[]) ?? [],
      removedKeys: (r.removedKeys as unknown as string[]) ?? [],
      modifiedKeys: (r.modifiedKeys as unknown as string[]) ?? [],
      changeDetails: (r.changeDetails as unknown as TokenChangeDetails) ?? { added: {}, removed: {}, modified: {} },
      message: r.message ?? null,
      aiSummary: r.aiSummary ?? null,
    });
  }

  for (const r of pageRows) {
    all.push({
      id: r.id,
      entityType: 'page',
      pushedAt: (r.pushedAt instanceof Date ? r.pushedAt : new Date(r.pushedAt as string)).toISOString(),
      slug: r.slug,
      pageAction: (r.action as 'created' | 'updated' | 'deleted') ?? 'updated',
      pushedByName: r.pushedByName ?? null,
      trigger: r.trigger,
      titleBefore: r.titleBefore ?? null,
      titleAfter: r.titleAfter ?? null,
      markdownLengthBefore: r.markdownLengthBefore ?? null,
      markdownLengthAfter: r.markdownLengthAfter ?? null,
      message: r.message ?? null,
      aiSummary: r.aiSummary ?? null,
    });
  }

  // Sort descending by pushedAt, then take the top `limit`
  all.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  return all.slice(0, limit);
}

function defaultChangeSummary(): ComponentChangeSummary {
  return {
    firstVersion: false,
    metadataChanged: false,
    fieldsChanged: [],
    sourceAdded: [],
    sourceModified: [],
    sourceRemoved: [],
    artifactsChanged: false,
    artifactCount: 0,
  };
}
