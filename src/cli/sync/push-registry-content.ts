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
  const validationCfg = (handoff.runtimeConfig as any)?.validation;
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

// ─── Tokens ────────────────────────────────────────────────────────────────────

/**
 * Push the design tokens snapshot. Reads from the workspace's built
 * tokens.json at public/api/tokens.json (the output of `handoff-app fetch`).
 */
export async function pushRegistryTokens(handoff: Handoff): Promise<void> {
  const tokensPath = path.join(handoff.workingPath, 'public', 'api', 'tokens.json');
  if (!(await fs.pathExists(tokensPath))) {
    Logger.warn(`No tokens snapshot found at ${tokensPath}. Run \`handoff-app fetch\` first. Skipping tokens push.`);
    return;
  }

  const baseUrl = await resolveSyncRemoteUrl(handoff.workingPath);
  const bearer = await getSyncBearerToken(handoff.workingPath);
  const url = `${baseUrl}/api/registry/tokens`;

  const payload = await fs.readJson(tokensPath);
  Logger.info('Pushing registry tokens snapshot…');
  await postJson(url, bearer, { payload });
  Logger.success('Registry tokens pushed.');
}
