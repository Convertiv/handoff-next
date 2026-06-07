import fs from 'fs-extra';
import path from 'path';
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
  const data = handoff.config?.app ?? {};

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
};

/**
 * Derive a nav tree from the workspace's pages/ directory. Each .md file
 * becomes a leaf node; directories become categories. Frontmatter `title`
 * overrides the filename-derived title.
 *
 * Future page types (mdx, html, plugin per ADR-001 §7) will set their `type`
 * based on file extension or push metadata — for now everything is markdown.
 */
async function deriveNavigationFromPages(workingPath: string): Promise<NavigationNode[]> {
  const pagesDir = path.join(workingPath, 'pages');
  if (!(await fs.pathExists(pagesDir))) return [];

  const walk = async (dir: string, parentSlugParts: string[]): Promise<NavigationNode[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: NavigationNode[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const children = await walk(abs, [...parentSlugParts, entry.name]);
        if (children.length > 0) {
          nodes.push({
            slug: [...parentSlugParts, entry.name].join('/'),
            title: titleCase(entry.name),
            type: 'category',
            children,
          });
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = entry.name.replace(/\.md$/, '');
        // skip index.md — its parent dir already represents it
        if (stem === 'index') continue;
        nodes.push({
          slug: [...parentSlugParts, stem].join('/'),
          title: titleCase(stem),
          type: 'markdown',
        });
      }
    }
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
