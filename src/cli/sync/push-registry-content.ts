import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { getSyncBearerToken, resolveSyncRemoteUrl } from './sync-remote-env.js';

/**
 * Push the per-project content endpoints introduced in ADR-001 / P2:
 *   - /api/registry/config       — handoff.config.js's app block
 *   - /api/registry/theme        — compiled theme CSS bytes
 *   - /api/registry/navigation   — derived nav tree
 *   - /api/registry/tokens       — IDocumentationObject snapshot
 *
 * Each helper is independent — pushAll() calls them in sequence so partial
 * failures (e.g. nav not yet derived) don't block other pushes.
 */

async function postJson(url: string, bearer: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${url} failed (${res.status}): ${text || res.statusText}`);
  }
}

// ─── Config ────────────────────────────────────────────────────────────────────

export async function pushRegistryConfig(handoff: Handoff): Promise<void> {
  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/config`;

  // The `app` block of handoff.config.js carries title, client, breakpoints,
  // sort orders, base_path, attribution flag, ports, etc. — everything the
  // registry needs to identify this project at runtime.
  const data: Record<string, unknown> = { ...(handoff.config?.app ?? {}) };

  // Derive a validation manifest from the workspace's validation config.
  // The registry uses this to:
  //  (a) decide whether to show the /system/health page link
  //  (b) know which validators to expect (vs "not run yet")
  // We push only the stable IDs/names — not the full Validator objects (which
  // contain closures and can't be serialized).
  // NOTE: `validation` lives on `handoff.config` (the full project config), NOT
  // on `handoff.runtimeConfig` (which only carries component-level options).
  const validationCfg = (handoff.config as any)?.validation;
  if (validationCfg?.validators?.length) {
    data.validationManifest = {
      configured: true,
      runOn: validationCfg.runOn ?? 'push',
      validators: (validationCfg.validators as Array<{ id: string; name: string; description?: string }>)
        .map((v) => ({ id: v.id, name: v.name, description: v.description })),
    };
  } else {
    // Explicitly clear any stale manifest if validators were removed
    data.validationManifest = { configured: false, validators: [], runOn: 'push' };
  }

  Logger.info('Pushing registry config…');
  await postJson(url, bearer, { data });
  Logger.success('Registry config pushed.');
}

// ─── Theme ─────────────────────────────────────────────────────────────────────

/**
 * Look for the workspace's compiled theme CSS. Priority order:
 *   1. <workingPath>/theme.css                — most common location
 *   2. <workingPath>/public/theme.css         — alternate convention
 *   3. <workingPath>/.handoff/runtime/css/theme.css — legacy materialized output
 */
function findThemeCssPath(workingPath: string): string | null {
  const candidates = [
    path.join(workingPath, 'theme.css'),
    path.join(workingPath, 'public', 'theme.css'),
    path.join(workingPath, '.handoff', 'runtime', 'css', 'theme.css'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function pushRegistryTheme(handoff: Handoff): Promise<void> {
  const themePath = findThemeCssPath(handoff.workingPath);
  if (!themePath) {
    Logger.warn('No theme.css found in workspace (checked theme.css, public/theme.css, .handoff/runtime/css/theme.css). Skipping theme push.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/theme`;
  const css = await fs.readFile(themePath, 'utf8');

  Logger.info(`Pushing registry theme (${Math.round(css.length / 1024)}KB from ${path.relative(handoff.workingPath, themePath)})…`);
  await postJson(url, bearer, { css });
  Logger.success('Registry theme pushed.');
}

// ─── Navigation ────────────────────────────────────────────────────────────────

export type NavigationNode = {
  slug: string;
  title: string;
  type: string;
  children?: NavigationNode[];
  /**
   * Explicit sidebar definition pulled from the page's frontmatter `menu:` key.
   * When present, the registry uses this verbatim as the section's subSections
   * (with group labels, icons, and nested children intact) instead of falling
   * back to the auto-walked children list. This is how a project pins a
   * curated sidebar (e.g. Foundations grouped under "Getting Started",
   * "Foundations", "Assets") rather than getting a flat list of every .md.
   */
  definition?: unknown;
  /** Icon hint pulled from frontmatter. Surfaced for top-level entries. */
  icon?: string;
  /** Page weight for sort order (lower = earlier). */
  weight?: number;
};

/**
 * Derive a nav tree from the workspace's pages/ directory. Each .md file
 * becomes a leaf node; directories become categories. Frontmatter `title`
 * overrides the filename-derived title.
 *
 * Future page types (mdx, html, plugin per ADR-001 §7) will set their `type`
 * based on file extension or push metadata — for now everything is markdown.
 */
/** Lightweight frontmatter shape we care about for nav. */
type PageFrontmatter = {
  title?: string;
  menuTitle?: string;
  enabled?: boolean;
  weight?: number;
  icon?: string;
  menu?: unknown;
};

async function readFrontmatter(filePath: string): Promise<PageFrontmatter | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    return (parsed.data ?? {}) as PageFrontmatter;
  } catch {
    return null;
  }
}

async function deriveNavigationFromPages(workingPath: string): Promise<NavigationNode[]> {
  const pagesDir = path.join(workingPath, 'pages');
  if (!(await fs.pathExists(pagesDir))) return [];

  /**
   * Find the index .md file for a given dir, if any. Either `dir/index.md` or
   * `dir.md` (the sibling-stem convention) can play that role. The frontmatter
   * on that file is what defines the section: its `title`, `icon`, `weight`,
   * and crucially the `menu:` definition the registry sidebar renders from.
   */
  const findIndexFrontmatter = async (
    parentDir: string,
    name: string,
    isDir: boolean
  ): Promise<PageFrontmatter | null> => {
    if (isDir) {
      const inside = path.join(parentDir, name, 'index.md');
      if (await fs.pathExists(inside)) return readFrontmatter(inside);
      const sibling = path.join(parentDir, `${name}.md`);
      if (await fs.pathExists(sibling)) return readFrontmatter(sibling);
      return null;
    }
    return readFrontmatter(path.join(parentDir, `${name}.md`));
  };

  const walk = async (dir: string, parentSlugParts: string[]): Promise<NavigationNode[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const visible = entries.filter((e) => !e.name.startsWith('.') && !e.name.startsWith('_'));
    // Sibling `foo.md` next to `foo/` represents the directory's index page —
    // skip the standalone .md node so the slug doesn't get pushed twice.
    const dirStems = new Set(visible.filter((e) => e.isDirectory()).map((e) => e.name));

    const nodes: NavigationNode[] = [];
    for (const entry of visible.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const stem = entry.name;
        const children = await walk(abs, [...parentSlugParts, stem]);
        const fm = await findIndexFrontmatter(dir, stem, true);
        if (fm?.enabled === false) continue;
        if (children.length === 0 && !fm) continue;
        nodes.push({
          slug: [...parentSlugParts, stem].join('/'),
          title: fm?.menuTitle ?? fm?.title ?? titleCase(stem),
          type: 'category',
          children: children.length > 0 ? children : undefined,
          definition: fm?.menu,
          icon: fm?.icon,
          weight: fm?.weight,
        });
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = entry.name.replace(/\.md$/, '');
        if (stem === 'index') continue;
        if (dirStems.has(stem)) continue;
        const fm = await readFrontmatter(abs);
        if (fm?.enabled === false) continue;
        nodes.push({
          slug: [...parentSlugParts, stem].join('/'),
          title: fm?.menuTitle ?? fm?.title ?? titleCase(stem),
          type: 'markdown',
          definition: fm?.menu,
          icon: fm?.icon,
          weight: fm?.weight,
        });
      }
    }
    // Stable sort by weight (lower first), title as tie-break.
    nodes.sort((a, b) => {
      const aw = a.weight ?? 0;
      const bw = b.weight ?? 0;
      if (aw !== bw) return aw - bw;
      return a.title.localeCompare(b.title);
    });
    return nodes;
  };

  return walk(pagesDir, []);
}

function titleCase(s: string): string {
  return s
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function pushRegistryNavigation(handoff: Handoff): Promise<void> {
  const tree = await deriveNavigationFromPages(handoff.workingPath);
  if (tree.length === 0) {
    Logger.warn('No pages found to build navigation tree. Skipping nav push.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/navigation`;

  Logger.info(`Pushing registry navigation (${tree.length} top-level nodes)…`);
  await postJson(url, bearer, { tree });
  Logger.success('Registry navigation pushed.');
}

// ─── Pages ─────────────────────────────────────────────────────────────────────

/**
 * Push every page markdown file from the workspace's `pages/` directory to the
 * registry's `handoff_page` table. Navigation is pushed separately (see
 * pushRegistryNavigation) so this step only carries content — frontmatter + body.
 *
 * Sending all pages in a single batched POST avoids per-file round-trips while
 * staying within Vercel's 4.5 MB function payload limit in most workspaces.
 */
export async function pushRegistryPages(handoff: Handoff): Promise<void> {
  const pagesDir = path.join(handoff.workingPath, 'pages');
  if (!(await fs.pathExists(pagesDir))) {
    Logger.warn('No pages/ directory found in workspace. Skipping pages content push.');
    return;
  }

  const collected: Array<{ slug: string; frontmatter: Record<string, unknown>; markdown: string }> = [];

  const walk = async (dir: string, slugParts: string[]): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirStems = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, [...slugParts, entry.name]);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = entry.name.replace(/\.md$/, '');
        // Skip index files that represent directory sections — nav handles these
        if (stem === 'index') continue;
        // Skip sibling .md files that act as directory indexes (foo.md alongside foo/)
        if (dirStems.has(stem)) continue;
        const raw = await fs.readFile(abs, 'utf-8');
        const { data: frontmatter, content: markdown } = matter(raw);
        const slug = [...slugParts, stem].join('/');
        collected.push({ slug, frontmatter: frontmatter as Record<string, unknown>, markdown });
      }
    }
  };

  await walk(pagesDir, []);

  if (collected.length === 0) {
    Logger.warn('No .md pages found in pages/ directory. Skipping pages content push.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/pages`;

  Logger.info(`Pushing ${collected.length} page(s) to registry…`);
  await postJson(url, bearer, { pages: collected });
  Logger.success(`Registry pages pushed (${collected.length} page(s)).`);
}

// ─── Tokens ────────────────────────────────────────────────────────────────────

/**
 * Push the design tokens snapshot. Reads from the workspace's built
 * tokens.json at public/api/tokens.json (the output of `handoff-app fetch`).
 */
export async function pushRegistryTokens(handoff: Handoff): Promise<void> {
  const tokensPath = path.join(handoff.workingPath, 'public', 'api', 'tokens.json');
  if (!(await fs.pathExists(tokensPath))) {
    // Fail loudly rather than skip: the Figma `localStyles` snapshot this pushes is
    // what the registry's foundation visual displays (colors, typography, effects)
    // read. Silently skipping leaves those pages blank on the registry. If a
    // workspace intentionally has no Figma tokens, pass --skip-tokens.
    throw new Error(
      `No tokens snapshot found at ${tokensPath}. Run \`handoff-app fetch\` first, or pass --skip-tokens to omit this step intentionally.`
    );
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/tokens`;

  const payload = await fs.readJson(tokensPath);
  Logger.info('Pushing registry tokens snapshot…');
  await postJson(url, bearer, { payload });
  Logger.success('Registry tokens pushed.');
}

// ─── DTCG ──────────────────────────────────────────────────────────────────────

/**
 * Push the DTCG token pipeline output. Reads from the workspace's
 * design-system/dist/ directory (the output of `handoff-app tokens:build`).
 *
 * Sends all four compiled formats (CSS, SCSS, Tailwind, resolved DTCG JSON)
 * plus the manifest to POST /api/registry/dtcg so the registry can serve
 * foundation pages without access to the workspace filesystem.
 *
 * If design-system/dist/ doesn't exist, warns and skips — run `handoff-app tokens:build`
 * in the workspace before push:all if you want DTCG data on the registry.
 */
/** Collect brand token files from design-system/tokens/brands/ and shared/. */
async function collectBrandTokens(dsRoot: string): Promise<Record<string, Record<string, unknown>>> {
  const brands: Record<string, Record<string, unknown>> = {};

  const sharedGray = path.join(dsRoot, 'tokens', 'shared', 'gray.tokens.json');
  if (await fs.pathExists(sharedGray)) {
    brands['shared'] = await fs.readJson(sharedGray);
  }

  const brandsDir = path.join(dsRoot, 'tokens', 'brands');
  if (await fs.pathExists(brandsDir)) {
    for (const entry of await fs.readdir(brandsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tokens.json')) {
        const brandName = entry.name.replace(/\.tokens\.json$/, '');
        brands[brandName] = await fs.readJson(path.join(brandsDir, entry.name));
      }
    }
  }

  return brands;
}

export async function pushRegistryDtcg(handoff: Handoff): Promise<void> {
  const dsRoot  = path.join(handoff.workingPath, 'design-system');
  const dsDist  = path.join(dsRoot, 'dist');
  const manifestPath = path.join(dsRoot, 'manifest.json');

  if (!(await fs.pathExists(dsDist))) {
    Logger.warn(`No design-system/dist/ found at ${dsDist}. Run \`handoff-app tokens:build\` first. Skipping DTCG push.`);
    return;
  }

  const cssPath      = path.join(dsDist, 'css', 'tokens.css');
  const scssPath     = path.join(dsDist, 'scss', '_tokens.scss');
  const tailwindPath = path.join(dsDist, 'tailwind', 'theme.css');
  const dtcgPath     = path.join(dsDist, 'dtcg', 'tokens.resolved.json');

  const missing = [cssPath, scssPath, tailwindPath, dtcgPath].filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    Logger.warn(`Missing DTCG dist files: ${missing.map((p) => path.relative(handoff.workingPath, p)).join(', ')}. Run \`handoff-app tokens:build\`. Skipping DTCG push.`);
    return;
  }

  const [css, scss, tailwind, dtcg, manifest, brands] = await Promise.all([
    fs.readFile(cssPath, 'utf-8'),
    fs.readFile(scssPath, 'utf-8'),
    fs.readFile(tailwindPath, 'utf-8'),
    fs.readJson(dtcgPath),
    fs.pathExists(manifestPath).then((exists) => (exists ? fs.readJson(manifestPath) : {})),
    collectBrandTokens(dsRoot),
  ]);

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer  = await getSyncBearerToken(handoff.workingPath);
  const url     = `${baseUrl}/api/registry/dtcg`;

  const brandNames = Object.keys(brands).filter((k) => k !== 'shared');
  const cssKb = Math.round(css.length / 1024);
  Logger.info(`Pushing DTCG token dist to registry (~${cssKb}KB CSS${brandNames.length ? `, brands: ${brandNames.join(', ')}` : ''})…`);
  await postJson(url, bearer, { manifest, css, scss, tailwind, dtcg, brands });
  Logger.success('Registry DTCG tokens pushed.');
}

/**
 * Push the icon catalog. Reads from `icons/catalog.json` in the workspace root
 * (an array of IconCatalogEntry). Skips gracefully if the file doesn't exist.
 */
export async function pushRegistryIcons(handoff: Handoff): Promise<void> {
  const catalogPath = path.join(handoff.workingPath, 'icons', 'catalog.json');
  if (!(await fs.pathExists(catalogPath))) {
    Logger.warn(`No icon catalog found at ${catalogPath}. Create icons/catalog.json to push icon data. Skipping.`);
    return;
  }
  const catalog = await fs.readJson(catalogPath);
  if (!Array.isArray(catalog)) {
    Logger.warn('icons/catalog.json must be a JSON array. Skipping icon push.');
    return;
  }
  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  Logger.info(`Pushing icon catalog (${catalog.length} icons)…`);
  await postJson(`${baseUrl}/api/registry/icons`, bearer, { catalog });
  Logger.success('Registry icon catalog pushed.');
}

/**
 * Push the logo set. Reads from `logos/logo-set.json` in the workspace root
 * (a LogoSet object). SVG content for custom logos is inlined in the JSON.
 * Skips gracefully if the file doesn't exist.
 */
export async function pushRegistryLogos(handoff: Handoff): Promise<void> {
  const logoSetPath = path.join(handoff.workingPath, 'logos', 'logo-set.json');
  if (!(await fs.pathExists(logoSetPath))) {
    Logger.warn(`No logo set found at ${logoSetPath}. Create logos/logo-set.json to push logo data. Skipping.`);
    return;
  }
  const logoSet = await fs.readJson(logoSetPath);
  if (typeof logoSet !== 'object' || Array.isArray(logoSet)) {
    Logger.warn('logos/logo-set.json must be a JSON object. Skipping logo push.');
    return;
  }
  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  Logger.info('Pushing logo set…');
  await postJson(`${baseUrl}/api/registry/logos`, bearer, { logoSet });
  Logger.success('Registry logo set pushed.');
}

// ─── Fonts ──────────────────────────────────────────────────────────────────

// ─── Component-referenced images ───────────────────────────────────────────

export type ReferencedImageInput = {
  assetId: string;
  filename: string;
  contentHash: string;
  mime: string;
  dataBase64: string;
  refs: string[];
};

/**
 * Push component-referenced images to the registry's dedicated ingest endpoint.
 * Each image is sent individually so no request exceeds Vercel's 4.5MB limit.
 * Returns the number of images successfully ingested.
 */
export async function pushComponentImages(
  handoff: Handoff,
  componentId: string,
  images: ReferencedImageInput[]
): Promise<number> {
  if (images.length === 0) return 0;
  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  let ok = 0;
  for (const img of images) {
    try {
      await postJson(`${baseUrl}/api/registry/assets/ingest`, bearer, {
        assetId: img.assetId,
        filename: img.filename,
        contentHash: img.contentHash,
        mimeType: img.mime,
        dataBase64: img.dataBase64,
        componentId,
        refs: img.refs,
      });
      ok++;
    } catch (e) {
      Logger.warn(`  Image "${img.filename}" for component "${componentId}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return ok;
}

// ─── Fonts ──────────────────────────────────────────────────────────────────

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)$/i;

function weightFromVariant(variant: string): number {
  const s = variant.toLowerCase().replace(/(slanted|slant|italic|oblique)/g, '').trim();
  const num = s.match(/([1-9]00)/);
  if (num) return parseInt(num[1], 10);
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/semibold|demibold|demi/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/medium/.test(s)) return 500;
  if (/light/.test(s)) return 300;
  if (/bold/.test(s)) return 700;
  return 400; // regular / normal / book / unmatched
}

/** 'PPTelegraf' → 'PP Telegraf' (best-effort camelCase split for display). */
function camelToWords(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function parseFontFilename(fileName: string):
  | { familyKey: string; family: string; weight: number; style: string; format: string }
  | null {
  const m = fileName.match(FONT_EXT_RE);
  if (!m) return null;
  const format = m[1].toLowerCase();
  let base = fileName.slice(0, fileName.length - m[0].length);
  base = base.replace(/^subset-/i, '');
  const parts = base.split('-');
  let variant = '';
  let familyRaw = base;
  if (parts.length > 1) {
    variant = parts[parts.length - 1];
    familyRaw = parts.slice(0, -1).join('-');
  }
  const style = /(slant|italic|oblique)/i.test(variant) ? 'italic' : 'normal';
  const weight = weightFromVariant(variant);
  const familyKey = familyRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!familyKey) return null;
  return { familyKey, family: camelToWords(familyRaw), weight, style, format };
}

/**
 * Collect font files from the workspace and push them to the registry so:
 *   - theme.css @font-face `url('/fonts/<file>')` references resolve, and
 *   - the foundation rasterizer can render branded type samples (satori).
 *
 * Scans <workingPath>/public/fonts, <workingPath>/fonts, and
 * <workingPath>/.handoff/app/public/fonts (whichever exist). De-duplicates by
 * filename, preferring the first occurrence found.
 */
export async function pushRegistryFonts(handoff: Handoff): Promise<void> {
  const candidateDirs = [
    path.join(handoff.workingPath, 'public', 'fonts'),
    path.join(handoff.workingPath, 'fonts'),
    path.join(handoff.workingPath, '.handoff', 'app', 'public', 'fonts'),
  ];

  const seen = new Map<string, { dir: string }>();
  for (const dir of candidateDirs) {
    if (!(await fs.pathExists(dir))) continue;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!FONT_EXT_RE.test(name)) continue;
      if (!seen.has(name)) seen.set(name, { dir });
    }
  }

  if (seen.size === 0) {
    Logger.warn(
      `No font files found (checked ${candidateDirs.map((d) => path.relative(handoff.workingPath, d)).join(', ')}). Skipping font push.`
    );
    return;
  }

  const fonts: {
    filename: string;
    familyKey: string;
    family: string;
    weight: number;
    style: string;
    format: string;
    data: string;
  }[] = [];

  for (const [filename, { dir }] of seen) {
    const parsed = parseFontFilename(filename);
    if (!parsed) continue;
    try {
      const buf = await fs.readFile(path.join(dir, filename));
      fonts.push({ filename, ...parsed, data: buf.toString('base64') });
    } catch (e) {
      Logger.warn(`Could not read font ${filename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (fonts.length === 0) {
    Logger.warn('No readable font files to push. Skipping.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const families = Array.from(new Set(fonts.map((f) => f.family))).join(', ');
  const totalKb = Math.round(fonts.reduce((n, f) => n + f.data.length * 0.75, 0) / 1024);

  // Send one font per request — each font file is typically 50–400KB, well under
  // Vercel's 4.5MB request limit. Sending individually avoids any batching math
  // and makes partial failures easy to diagnose without losing the whole push.
  Logger.info(`Pushing ${fonts.length} font file(s) [${families}] (~${totalKb}KB)…`);
  let pushed = 0;
  let failed = 0;
  for (const font of fonts) {
    try {
      await postJson(`${baseUrl}/api/registry/fonts`, bearer, { fonts: [font] });
      pushed++;
    } catch (e) {
      failed++;
      Logger.warn(`  Failed to push font "${font.filename}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed > 0) {
    Logger.warn(`Registry fonts: ${pushed} pushed, ${failed} failed.`);
  } else {
    Logger.success(`Registry fonts pushed (${pushed}).`);
  }
}

// ─── Figma image fills ──────────────────────────────────────────────────────

type FigmaFillManifestEntry = {
  assetId: string;
  imageRef: string;
  filename: string;
  contentHash: string;
  mimeType: string;
};

type FigmaFillManifest = {
  figmaFileKey: string;
  fills: FigmaFillManifestEntry[];
};

/**
 * Push Figma image fills cached during `handoff-app fetch` to the asset DAM.
 * Reads `figma-fills/fills.json` + image files written by `fetchAndSaveFigmaImageFills`.
 * Each image is sent individually to stay under Vercel's 4.5MB body limit.
 */
export async function pushFigmaImageFills(handoff: Handoff): Promise<void> {
  const fillsDir = path.join(handoff.getOutputPath(), 'figma-fills');
  const manifestPath = path.join(fillsDir, 'fills.json');

  if (!(await fs.pathExists(manifestPath))) {
    Logger.warn(
      `No Figma image fills manifest at ${manifestPath}. ` +
      `Run \`handoff-app fetch\` first to download image fills. Skipping.`
    );
    return;
  }

  const manifest = (await fs.readJson(manifestPath)) as FigmaFillManifest;
  if (!Array.isArray(manifest.fills) || manifest.fills.length === 0) {
    Logger.info('No Figma image fills to push.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/assets/ingest-figma-fills`;

  Logger.info(`Pushing ${manifest.fills.length} Figma image fill(s) to asset library…`);
  let ok = 0;
  for (const fill of manifest.fills) {
    try {
      const filePath = path.join(fillsDir, fill.filename);
      if (!(await fs.pathExists(filePath))) {
        Logger.warn(`  Fill "${fill.imageRef}": file not found at ${filePath} — skipping.`);
        continue;
      }
      const bytes = await fs.readFile(filePath);
      const dataBase64 = bytes.toString('base64');
      await postJson(url, bearer, {
        assetId: fill.assetId,
        filename: fill.filename,
        contentHash: fill.contentHash,
        mimeType: fill.mimeType,
        dataBase64,
        figmaFileKey: manifest.figmaFileKey,
        figmaImageRef: fill.imageRef,
      });
      ok++;
    } catch (e) {
      Logger.warn(`  Fill "${fill.imageRef}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  Logger.success(`Figma image fills pushed: ${ok}/${manifest.fills.length} succeeded.`);
}

// ─── Image slots ────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function toAspectRatio(w: number, h: number): { w: number; h: number } | null {
  const wi = Math.round(w);
  const hi = Math.round(h);
  if (!wi || !hi) return null;
  const d = gcd(wi, hi);
  const rw = wi / d;
  const rh = hi / d;
  // If either component exceeds 99, the ratio is too irreducible to be meaningful
  // (e.g. 1366×768 → 683:384). Fall back to rounding to nearest common ratio.
  if (rw > 99 || rh > 99) {
    const decimal = wi / hi;
    const commonRatios: [number, number][] = [
      [1, 1], [4, 3], [3, 2], [16, 10], [5, 3], [16, 9], [2, 1],
      [21, 9], [3, 1], [9, 16], [3, 4], [2, 3], [9, 21], [4, 5],
    ];
    let best: [number, number] = [wi, hi];
    let bestDiff = Infinity;
    for (const [cw, ch] of commonRatios) {
      const diff = Math.abs(decimal - cw / ch);
      if (diff < bestDiff) { bestDiff = diff; best = [cw, ch]; }
    }
    return { w: best[0], h: best[1] };
  }
  return { w: rw, h: rh };
}

type FigmaImageFill = {
  name?: string;
  nodeId?: string;
  width?: number;
  height?: number;
  scaleMode?: string;
  isResponsive?: boolean;
  minWidth?: number;
  minHeight?: number;
};

type DocumentationComponent = {
  id?: string;
  figmaImages?: FigmaImageFill[];
};

/**
 * Extract image sizing specs from the Figma tokens snapshot and push them to
 * the registry's /api/registry/image-slots endpoint. Reads from the workspace's
 * output tokens.json (written by `handoff-app fetch`). Batches components to
 * avoid oversized requests.
 */
export async function pushImageSlots(handoff: Handoff): Promise<void> {
  const tokensPath = handoff.getTokensFilePath();
  if (!(await fs.pathExists(tokensPath))) {
    Logger.warn(`No tokens file at ${tokensPath}. Run \`handoff-app fetch\` first. Skipping image slots push.`);
    return;
  }

  const snapshot = await fs.readJson(tokensPath) as { components?: DocumentationComponent[] };
  const components = Array.isArray(snapshot.components) ? snapshot.components : [];

  const allSlots: Array<{ componentId: string; slot: FigmaImageFill }> = [];
  for (const comp of components) {
    const compId = comp.id;
    if (!compId || !Array.isArray(comp.figmaImages)) continue;
    for (const img of comp.figmaImages) {
      if (img.width && img.height) {
        allSlots.push({ componentId: compId, slot: img });
      }
    }
  }

  if (allSlots.length === 0) {
    Logger.info('No Figma image slots with sizing data found — nothing to push.');
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/image-slots`;

  // Build deduplicated slot records, keyed by (componentId, slotName, nodeId)
  const seen = new Set<string>();
  const slots = allSlots
    .map(({ componentId, slot }) => {
      const slotName = slot.name ?? 'image';
      const nodeId = slot.nodeId ?? null;
      const key = `${componentId}:${slotName}:${nodeId ?? ''}`;
      if (seen.has(key)) return null;
      seen.add(key);

      const ratio = slot.width && slot.height ? toAspectRatio(slot.width, slot.height) : null;
      const idHash = Buffer.from(key).toString('base64url').slice(0, 32);

      return {
        id: idHash,
        componentId,
        slotName,
        nodeId,
        variantKey: null,
        recommendedWidth: slot.width ?? null,
        recommendedHeight: slot.height ?? null,
        aspectRatioW: ratio?.w ?? null,
        aspectRatioH: ratio?.h ?? null,
        scaleMode: slot.scaleMode ?? null,
        isResponsive: slot.isResponsive ?? false,
        minWidth: slot.minWidth ?? null,
        minHeight: slot.minHeight ?? null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const componentIds = [...new Set(slots.map((s) => s.componentId))];

  Logger.info(`Pushing ${slots.length} image slot(s) across ${componentIds.length} component(s)…`);

  // Batch by component: send up to 50 components at a time
  const BATCH = 50;
  for (let i = 0; i < componentIds.length; i += BATCH) {
    const batchCompIds = componentIds.slice(i, i + BATCH);
    const batchSlots = slots.filter((s) => batchCompIds.includes(s.componentId));
    try {
      await postJson(url, bearer, { componentIds: batchCompIds, slots: batchSlots });
    } catch (e) {
      Logger.warn(`  Image slots batch ${Math.floor(i / BATCH) + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  Logger.success(`Image slots pushed (${slots.length} slot(s)).`);
}
