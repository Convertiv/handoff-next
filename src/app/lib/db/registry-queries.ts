import 'server-only';
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from './index';
import {
  handoffRegistryConfig,
  handoffRegistryTheme,
  handoffRegistryNavigation,
  handoffTokenChanges,
  handoffTokensSnapshots,
} from './schema-pg';

const SINGLETON_ID = 'default';

// ─── Registry config ───────────────────────────────────────────────────────────

export type RegistryConfigData = Record<string, unknown>;

export async function getRegistryConfig(): Promise<RegistryConfigData | null> {
  const db = getDb();
  const rows = await db.select().from(handoffRegistryConfig).where(eq(handoffRegistryConfig.id, SINGLETON_ID)).limit(1);
  return (rows[0]?.data as RegistryConfigData) ?? null;
}

export async function upsertRegistryConfig(data: RegistryConfigData, userId: string | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffRegistryConfig)
    .values({ id: SINGLETON_ID, data, updatedAt: new Date(), updatedByUserId: userId })
    .onConflictDoUpdate({
      target: handoffRegistryConfig.id,
      set: { data, updatedAt: new Date(), updatedByUserId: userId },
    });
}

// ─── Registry theme ────────────────────────────────────────────────────────────

export type RegistryThemeRow = { css: string; updatedAt: Date | null };

export async function getRegistryTheme(): Promise<RegistryThemeRow | null> {
  const db = getDb();
  const rows = await db.select().from(handoffRegistryTheme).where(eq(handoffRegistryTheme.id, SINGLETON_ID)).limit(1);
  if (!rows[0]) return null;
  return { css: rows[0].css ?? '', updatedAt: rows[0].updatedAt ?? null };
}

export async function upsertRegistryTheme(css: string, userId: string | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffRegistryTheme)
    .values({ id: SINGLETON_ID, css, updatedAt: new Date(), updatedByUserId: userId })
    .onConflictDoUpdate({
      target: handoffRegistryTheme.id,
      set: { css, updatedAt: new Date(), updatedByUserId: userId },
    });
}

// ─── Registry navigation ───────────────────────────────────────────────────────

export type NavigationNode = {
  slug: string;
  title: string;
  /** 'markdown' | 'mdx' | 'html' | 'plugin' | 'category' — see ADR-001 §7 */
  type: string;
  children?: NavigationNode[];
  /**
   * Optional sidebar definition lifted from the page's frontmatter `menu:`
   * key during push. The registry uses this verbatim (after coercion) as the
   * section's subSections — preserves group labels, icons, and nested
   * children that the auto-walked tree can't infer. Stored as `unknown`
   * because shape is project-authored YAML.
   */
  definition?: unknown;
  icon?: string;
  weight?: number;
};

export async function getRegistryNavigation(): Promise<NavigationNode[] | null> {
  const db = getDb();
  const rows = await db.select().from(handoffRegistryNavigation).where(eq(handoffRegistryNavigation.id, SINGLETON_ID)).limit(1);
  return (rows[0]?.tree as NavigationNode[]) ?? null;
}

export async function upsertRegistryNavigation(tree: NavigationNode[], userId: string | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffRegistryNavigation)
    .values({ id: SINGLETON_ID, tree, updatedAt: new Date(), updatedByUserId: userId })
    .onConflictDoUpdate({
      target: handoffRegistryNavigation.id,
      set: { tree, updatedAt: new Date(), updatedByUserId: userId },
    });
}

// ─── Tokens snapshot ───────────────────────────────────────────────────────────
// Existing handoff_tokens_snapshot table is append-only — each push inserts a row.
// Latest row wins for reads. Each push also writes a handoff_token_change diff row.

/**
 * Flatten a token payload into a map of { "<category>/<name>": fingerprint }.
 * Arrays of objects with a `name` field are walked; other shapes are treated
 * as a single entry keyed by the category name.
 */
function flattenTokenPayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const flat: Record<string, string> = {};
  for (const [category, items] of Object.entries(payload as Record<string, unknown>)) {
    if (Array.isArray(items)) {
      items.forEach((item, idx) => {
        const name =
          item && typeof item === 'object' && 'name' in item
            ? String((item as Record<string, unknown>).name)
            : String(idx);
        const key = `${category}/${name}`;
        flat[key] = createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 12);
      });
    } else if (items !== null && typeof items === 'object') {
      flat[category] = createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
    }
  }
  return flat;
}

export async function insertTokensSnapshot(payload: unknown, trigger = 'push'): Promise<void> {
  const db = getDb();

  // ── 1. Read the previous snapshot for diffing ──────────────────────────────
  const [prev] = await db
    .select({ id: handoffTokensSnapshots.id, payload: handoffTokensSnapshots.payload })
    .from(handoffTokensSnapshots)
    .orderBy(desc(handoffTokensSnapshots.id))
    .limit(1);

  // ── 2. Insert the new snapshot ─────────────────────────────────────────────
  const [inserted] = await db
    .insert(handoffTokensSnapshots)
    .values({ payload })
    .returning({ id: handoffTokensSnapshots.id });
  const snapshotId = inserted?.id ?? null;

  // ── 3. Compute diff ────────────────────────────────────────────────────────
  const newFlat = flattenTokenPayload(payload);
  const prevFlat = prev ? flattenTokenPayload(prev.payload as unknown) : {};

  const newKeys = new Set(Object.keys(newFlat));
  const prevKeys = new Set(Object.keys(prevFlat));

  const addedKeys = [...newKeys].filter((k) => !prevKeys.has(k));
  const removedKeys = [...prevKeys].filter((k) => !newKeys.has(k));
  const modifiedKeys = [...newKeys].filter((k) => prevKeys.has(k) && newFlat[k] !== prevFlat[k]);

  // ── 4. Insert change record (fire-and-forget — never surface to caller) ───
  await db.insert(handoffTokenChanges).values({
    trigger,
    addedCount: addedKeys.length,
    removedCount: removedKeys.length,
    modifiedCount: modifiedKeys.length,
    totalCount: newKeys.size,
    addedKeys,
    removedKeys,
    modifiedKeys,
    snapshotId,
  });
}
