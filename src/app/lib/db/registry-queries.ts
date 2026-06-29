import 'server-only';
import { createHash } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from './index';
import {
  handoffRegistryConfig,
  handoffRegistryTheme,
  handoffRegistryAppearance,
  handoffRegistryNavigation,
  handoffRegistryDtcg,
  handoffRegistryFonts,
  handoffRegistryLogos,
  handoffImageSlots,
  handoffTokenChanges,
  handoffTokensSnapshots,
  users,
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
/** Best-effort display value for a flattened token item (the meaningful bit a
 *  human reads in a diff — the hex/dimension/etc., not the metadata wrapper). */
function tokenDisplayValue(item: unknown): unknown {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    if ('value' in o) return o.value;
    // No single `value` — drop the redundant `name` (it's already in the key).
    const { name: _name, ...rest } = o;
    return rest;
  }
  return item;
}

/**
 * Flatten a token payload to { "<category>/<name>": { fp, value } } — `fp` is a
 * fingerprint for change detection, `value` the display value for diffs. Arrays
 * of named objects are walked; other object shapes are a single entry.
 */
function flattenTokenItems(payload: unknown): Record<string, { fp: string; value: unknown }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const flat: Record<string, { fp: string; value: unknown }> = {};
  for (const [category, items] of Object.entries(payload as Record<string, unknown>)) {
    if (Array.isArray(items)) {
      items.forEach((item, idx) => {
        const name =
          item && typeof item === 'object' && 'name' in item
            ? String((item as Record<string, unknown>).name)
            : String(idx);
        const key = `${category}/${name}`;
        flat[key] = {
          fp: createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 12),
          value: tokenDisplayValue(item),
        };
      });
    } else if (items !== null && typeof items === 'object') {
      flat[category] = {
        fp: createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12),
        value: tokenDisplayValue(items),
      };
    }
  }
  return flat;
}

/** Above this many changed keys we record counts + key names but omit value
 *  bodies, so a first push (everything "added") can't balloon the row. */
const TOKEN_DETAIL_CAP = 400;

export interface TokenChangeDetails {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Record<string, { before: unknown; after: unknown }>;
  truncated?: boolean;
}

export async function insertTokensSnapshot(
  payload: unknown,
  opts: { trigger?: string; userId?: string | null; message?: string | null } = {}
): Promise<void> {
  const db = getDb();
  const trigger = opts.trigger ?? 'push';

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

  // ── 3. Compute diff (keys + before/after values) ───────────────────────────
  const newFlat = flattenTokenItems(payload);
  const prevFlat = prev ? flattenTokenItems(prev.payload as unknown) : {};

  const newKeys = new Set(Object.keys(newFlat));
  const prevKeys = new Set(Object.keys(prevFlat));

  const addedKeys = [...newKeys].filter((k) => !prevKeys.has(k));
  const removedKeys = [...prevKeys].filter((k) => !newKeys.has(k));
  const modifiedKeys = [...newKeys].filter((k) => prevKeys.has(k) && newFlat[k].fp !== prevFlat[k].fp);

  // Record actual values for changed keys — capped so an initial all-added push
  // doesn't duplicate the whole snapshot into the change row.
  const changedTotal = addedKeys.length + removedKeys.length + modifiedKeys.length;
  const details: TokenChangeDetails = { added: {}, removed: {}, modified: {} };
  if (changedTotal <= TOKEN_DETAIL_CAP) {
    for (const k of addedKeys) details.added[k] = newFlat[k].value;
    for (const k of removedKeys) details.removed[k] = prevFlat[k].value;
    for (const k of modifiedKeys) details.modified[k] = { before: prevFlat[k].value, after: newFlat[k].value };
  } else {
    details.truncated = true;
  }

  // ── 4. Resolve pusher display name (parity with component versions) ────────
  let pushedByName: string | null = null;
  if (opts.userId) {
    const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, opts.userId)).limit(1);
    pushedByName = u?.name ?? u?.email ?? null;
  }

  // ── 5. Insert change record (fire-and-forget — never surface to caller) ───
  await db.insert(handoffTokenChanges).values({
    trigger,
    addedCount: addedKeys.length,
    removedCount: removedKeys.length,
    modifiedCount: modifiedKeys.length,
    totalCount: newKeys.size,
    addedKeys,
    removedKeys,
    modifiedKeys,
    pushedByUserId: opts.userId ?? null,
    pushedByName,
    changeDetails: details,
    message: opts.message ?? null,
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

// ─── Registry logos ───────────────────────────────────────────────────────────

export type LogoVariant = {
  id: string;
  name: string;
  variant: string;
  form: string;
  svg: string;
  background?: string;
  usage?: string;
  description?: string;
};

export type LogoSet = {
  name: string;
  description?: string;
  variants: LogoVariant[];
};

export async function getRegistryLogoSet(): Promise<LogoSet | null> {
  const db = getDb();
  const [row] = await db.select().from(handoffRegistryLogos).where(eq(handoffRegistryLogos.id, SINGLETON_ID)).limit(1);
  if (!row?.logoSet) return null;
  return row.logoSet as LogoSet;
}

// ─── Registry appearance ──────────────────────────────────────────────────────

export type AppearanceSettings = {
  /** ID of a LogoVariant from the logo set */
  logoVariantId?: string;
  /** Custom SVG string uploaded by the user */
  customLogoSvg?: string;
  /** Map of CSS variable name → hex color value */
  colorOverrides?: Record<string, string>;
  /** Font family display name for --font-sans */
  fontSans?: string;
  /** Font family display name for --font-mono */
  fontMono?: string;
};

export type AppearanceRow = {
  settings: AppearanceSettings;
  css: string;
  updatedAt: Date | null;
};

export async function getRegistryAppearance(): Promise<AppearanceRow | null> {
  const db = getDb();
  const [row] = await db.select().from(handoffRegistryAppearance).where(eq(handoffRegistryAppearance.id, SINGLETON_ID)).limit(1);
  if (!row) return null;
  return {
    settings: (row.settings ?? {}) as AppearanceSettings,
    css: row.css ?? '',
    updatedAt: row.updatedAt ?? null,
  };
}

export async function upsertRegistryAppearance(
  settings: AppearanceSettings,
  css: string,
  userId: string | null = null,
): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffRegistryAppearance)
    .values({ id: SINGLETON_ID, settings, css, updatedAt: new Date(), updatedByUserId: userId })
    .onConflictDoUpdate({
      target: handoffRegistryAppearance.id,
      set: { settings, css, updatedAt: new Date(), updatedByUserId: userId },
    });
}

// ─── Image slots ───────────────────────────────────────────────────────────────

export type ImageSlotRow = typeof handoffImageSlots.$inferSelect;

export type ImageSlotInput = {
  id: string;
  componentId: string;
  slotName: string;
  nodeId?: string | null;
  variantKey?: string | null;
  recommendedWidth?: number | null;
  recommendedHeight?: number | null;
  aspectRatioW?: number | null;
  aspectRatioH?: number | null;
  scaleMode?: string | null;
  isResponsive?: boolean;
  minWidth?: number | null;
  minHeight?: number | null;
};

export async function upsertComponentImageSlots(slots: ImageSlotInput[]): Promise<void> {
  if (slots.length === 0) return;
  const db = getDb();
  for (const slot of slots) {
    await db
      .insert(handoffImageSlots)
      .values({ ...slot, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: handoffImageSlots.id,
        set: {
          slotName: slot.slotName,
          nodeId: slot.nodeId ?? null,
          variantKey: slot.variantKey ?? null,
          recommendedWidth: slot.recommendedWidth ?? null,
          recommendedHeight: slot.recommendedHeight ?? null,
          aspectRatioW: slot.aspectRatioW ?? null,
          aspectRatioH: slot.aspectRatioH ?? null,
          scaleMode: slot.scaleMode ?? null,
          isResponsive: slot.isResponsive ?? false,
          minWidth: slot.minWidth ?? null,
          minHeight: slot.minHeight ?? null,
          updatedAt: new Date(),
        },
      });
  }
}

export async function getImageSlotsForComponent(componentId: string): Promise<ImageSlotRow[]> {
  const db = getDb();
  return db
    .select()
    .from(handoffImageSlots)
    .where(eq(handoffImageSlots.componentId, componentId))
    .orderBy(asc(handoffImageSlots.slotName));
}

/** Delete all slots for the given component ids and replace with the provided batch. */
export async function replaceImageSlotsForComponents(
  componentIds: string[],
  slots: ImageSlotInput[],
): Promise<void> {
  if (componentIds.length === 0) return;
  const db = getDb();
  await db.delete(handoffImageSlots).where(inArray(handoffImageSlots.componentId, componentIds));
  if (slots.length > 0) {
    await db.insert(handoffImageSlots).values(slots.map((s) => ({ ...s, updatedAt: new Date() })));
  }
}
