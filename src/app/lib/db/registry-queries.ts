import 'server-only';
import { createHash } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb } from './index';
import {
  handoffRegistryConfig,
  handoffRegistryTheme,
  handoffRegistryNavigation,
  handoffRegistryDtcg,
  handoffRegistryFonts,
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

// ─── Registry DTCG ─────────────────────────────────────────────────────────────

export type RegistryDtcgPayload = {
  manifest: Record<string, unknown>;
  css: string;
  scss: string;
  tailwind: string;
  dtcg: Record<string, unknown>;
  /**
   * Brand token trees keyed by brand name (plus "shared" for the gray ramp).
   * Each value is a DTCG token file parsed from a CSS brand file.
   * Empty object when no brands are configured.
   */
  brands: Record<string, Record<string, unknown>>;
};

export async function getRegistryDtcg(): Promise<RegistryDtcgPayload | null> {
  const db = getDb();
  const rows = await db.select().from(handoffRegistryDtcg).where(eq(handoffRegistryDtcg.id, SINGLETON_ID)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    manifest: (row.manifest as Record<string, unknown>) ?? {},
    css: row.css ?? '',
    scss: row.scss ?? '',
    tailwind: row.tailwind ?? '',
    dtcg: (row.dtcg as Record<string, unknown>) ?? {},
    brands: (row.brands as Record<string, Record<string, unknown>>) ?? {},
  };
}

export async function upsertRegistryDtcg(payload: RegistryDtcgPayload, userId: string | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffRegistryDtcg)
    .values({ id: SINGLETON_ID, ...payload, updatedAt: new Date(), updatedByUserId: userId })
    .onConflictDoUpdate({
      target: handoffRegistryDtcg.id,
      set: { ...payload, updatedAt: new Date(), updatedByUserId: userId },
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

// ─── Registry fonts ──────────────────────────────────────────────────────────

export type RegistryFontInput = {
  filename: string;
  familyKey: string;
  family: string;
  weight: number;
  style: string;
  format: string;
  /** Base64-encoded bytes */
  data: string;
};

export type RegistryFontMeta = Omit<RegistryFontInput, 'data'> & { bytes: number; updatedAt: string | null };

/** Bulk upsert font files (one row per file), keyed by filename. */
export async function upsertRegistryFonts(fonts: RegistryFontInput[], userId: string | null = null): Promise<number> {
  if (!fonts.length) return 0;
  const db = getDb();
  for (const f of fonts) {
    await db
      .insert(handoffRegistryFonts)
      .values({
        filename: f.filename,
        familyKey: f.familyKey,
        family: f.family,
        weight: f.weight,
        style: f.style,
        format: f.format,
        data: f.data,
        updatedAt: new Date(),
        updatedByUserId: userId,
      })
      .onConflictDoUpdate({
        target: handoffRegistryFonts.filename,
        set: {
          familyKey: f.familyKey,
          family: f.family,
          weight: f.weight,
          style: f.style,
          format: f.format,
          data: f.data,
          updatedAt: new Date(),
          updatedByUserId: userId,
        },
      });
  }
  return fonts.length;
}

/** List font metadata (no bytes), ordered by family then weight. */
export async function listRegistryFonts(): Promise<RegistryFontMeta[]> {
  const db = getDb();
  const rows = await db
    .select({
      filename: handoffRegistryFonts.filename,
      familyKey: handoffRegistryFonts.familyKey,
      family: handoffRegistryFonts.family,
      weight: handoffRegistryFonts.weight,
      style: handoffRegistryFonts.style,
      format: handoffRegistryFonts.format,
      data: handoffRegistryFonts.data,
      updatedAt: handoffRegistryFonts.updatedAt,
    })
    .from(handoffRegistryFonts)
    .orderBy(asc(handoffRegistryFonts.familyKey), asc(handoffRegistryFonts.weight));
  return rows.map((r) => ({
    filename: r.filename,
    familyKey: r.familyKey,
    family: r.family,
    weight: r.weight,
    style: r.style,
    format: r.format,
    bytes: Math.floor((r.data?.length ?? 0) * 0.75),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

/** Serve a single font file's bytes by filename. */
export async function getRegistryFontFile(filename: string): Promise<{ data: Buffer; format: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ data: handoffRegistryFonts.data, format: handoffRegistryFonts.format })
    .from(handoffRegistryFonts)
    .where(eq(handoffRegistryFonts.filename, filename))
    .limit(1);
  if (!row?.data) return null;
  return { data: Buffer.from(row.data, 'base64'), format: row.format };
}

/**
 * Resolve a satori-usable font (ttf/otf/woff — NOT woff2, which satori can't
 * parse) for a family + requested weight, picking the closest available weight.
 */
export async function getRegistryFontForSatori(familyKey: string, weight: number): Promise<Buffer | null> {
  const db = getDb();
  const rows = await db
    .select({ weight: handoffRegistryFonts.weight, format: handoffRegistryFonts.format, data: handoffRegistryFonts.data, style: handoffRegistryFonts.style })
    .from(handoffRegistryFonts)
    .where(eq(handoffRegistryFonts.familyKey, familyKey));
  const usable = rows.filter(
    (r) => r.style === 'normal' && ['ttf', 'otf', 'woff'].includes((r.format || '').toLowerCase()) && r.data
  );
  if (!usable.length) return null;
  const pick =
    usable.find((r) => r.weight === weight) ??
    [...usable].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  return pick?.data ? Buffer.from(pick.data, 'base64') : null;
}

/** All distinct family keys present in the registry (for diagnostics). */
export async function listRegistryFontFamilyKeys(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ familyKey: handoffRegistryFonts.familyKey }).from(handoffRegistryFonts);
  return Array.from(new Set(rows.map((r) => r.familyKey)));
}
