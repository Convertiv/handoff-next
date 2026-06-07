import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import {
  handoffRegistryConfig,
  handoffRegistryTheme,
  handoffRegistryNavigation,
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
// Latest row wins for reads.

export async function insertTokensSnapshot(payload: unknown): Promise<void> {
  const db = getDb();
  await db.insert(handoffTokensSnapshots).values({ payload });
}
