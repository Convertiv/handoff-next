import matter from 'gray-matter';
import fs from 'fs-extra';
import path from 'path';
import type { SyncUploadBody } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { getDeclarationAbsPathForEntity } from './resolve-declaration.js';
import { getSyncBearerToken, resolveSyncRemoteUrl } from './sync-remote-env.js';

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  if (!(await fs.pathExists(rootDir))) return out;
  const walk = async (dir: string) => {
    const names = await fs.readdir(dir);
    for (const n of names) {
      const p = path.join(dir, n);
      const st = await fs.stat(p);
      if (st.isDirectory()) await walk(p);
      else if (n.endsWith('.md')) out.push(p);
    }
  };
  await walk(rootDir);
  return out;
}

async function readComponentOrPatternJson(handoff: Handoff, kind: 'component' | 'pattern', id: string): Promise<Record<string, unknown> | null> {
  const decl = getDeclarationAbsPathForEntity(handoff, kind, id);
  if (!decl) return null;
  const dir = path.dirname(decl);
  const jsonPath = path.join(dir, `${id}.handoff.json`);
  if (await fs.pathExists(jsonPath)) {
    return (await fs.readJson(jsonPath)) as Record<string, unknown>;
  }
  if (decl.endsWith('.json')) {
    return (await fs.readJson(decl)) as Record<string, unknown>;
  }
  return null;
}

export type RunPushOptions = {
  /** When set and non-empty, only these component ids are pushed (must exist in config). */
  componentIds?: string[];
  /** When set and non-empty, only these pattern ids are pushed (must exist in config). */
  patternIds?: string[];
  /** When set and non-empty, only these page slugs are pushed (paths under `pages/` without `.md`, e.g. `about` or `guides/colors`). */
  pageSlugs?: string[];
  /** List changes that would be uploaded without calling the remote API (no HANDOFF_CLOUD_* required). */
  dryRun?: boolean;
};

function normalizePageSlug(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Scan local project and POST declarations + pages to the remote Handoff API.
 */
export async function runPush(handoff: Handoff, opts?: RunPushOptions): Promise<void> {
  const workPath = handoff.workingPath;
  const dryRun = Boolean(opts?.dryRun);

  let baseUrl = '';
  let bearer = '';
  if (!dryRun) {
    baseUrl = await resolveSyncRemoteUrl(workPath);
    bearer = await getSyncBearerToken(workPath);
  }

  const changes: SyncUploadBody['changes'] = [];

  const selective =
    (opts?.componentIds?.length ?? 0) > 0 || (opts?.patternIds?.length ?? 0) > 0 || (opts?.pageSlugs?.length ?? 0) > 0;

  const pageSlugSet = selective && opts?.pageSlugs?.length
    ? new Set(opts.pageSlugs.map((s) => normalizePageSlug(s)))
    : null;

  const pagesDir = path.join(handoff.workingPath, 'pages');
  if (!selective || pageSlugSet) {
    const mdFiles = await collectMarkdownFiles(pagesDir);
    for (const abs of mdFiles) {
      const slug = path.relative(pagesDir, abs).replace(/\\/g, '/').replace(/\.md$/i, '');
      if (pageSlugSet && !pageSlugSet.has(slug)) continue;
      const raw = await fs.readFile(abs, 'utf8');
      const parsed = matter(raw);
      changes.push({
        entityType: 'page',
        entityId: slug,
        action: 'update',
        data: { slug, frontmatter: parsed.data as Record<string, unknown>, markdown: parsed.content },
      });
    }
    if (pageSlugSet) {
      for (const wanted of pageSlugSet) {
        if (!mdFiles.some((abs) => path.relative(pagesDir, abs).replace(/\\/g, '/').replace(/\.md$/i, '') === wanted)) {
          Logger.warn(`Page slug "${wanted}" not found under pages/ — skipped.`);
        }
      }
    }
  }

  const configuredCompIds = Object.keys(handoff.runtimeConfig?.entries?.components ?? {});
  const compIdsToScan = selective
    ? (opts?.componentIds?.length ? opts.componentIds : [])
    : configuredCompIds;
  if (selective && opts?.componentIds?.length) {
    const set = new Set(configuredCompIds);
    for (const id of opts.componentIds) {
      if (!set.has(id)) Logger.warn(`Component "${id}" is not in handoff.config entries.components — skipped.`);
    }
  }
  for (const id of compIdsToScan) {
    if (!configuredCompIds.includes(id)) continue;
    const data = await readComponentOrPatternJson(handoff, 'component', id);
    if (!data) {
      Logger.warn(`Skipping component "${id}" (no ${id}.handoff.json next to declaration — push supports JSON declarations only).`);
      continue;
    }
    changes.push({
      entityType: 'component',
      entityId: id,
      action: 'update',
      data: { id, ...data, data: (data as { data?: unknown }).data ?? data },
    });
  }

  const configuredPatIds = Object.keys(handoff.runtimeConfig?.entries?.patterns ?? {});
  const patIdsToScan = selective ? (opts?.patternIds?.length ? opts.patternIds : []) : configuredPatIds;
  if (selective && opts?.patternIds?.length) {
    const set = new Set(configuredPatIds);
    for (const id of opts.patternIds) {
      if (!set.has(id)) Logger.warn(`Pattern "${id}" is not in handoff.config entries.patterns — skipped.`);
    }
  }
  for (const id of patIdsToScan) {
    if (!configuredPatIds.includes(id)) continue;
    const data = await readComponentOrPatternJson(handoff, 'pattern', id);
    if (!data) {
      Logger.warn(`Skipping pattern "${id}" (no ${id}.handoff.json next to declaration — push supports JSON declarations only).`);
      continue;
    }
    changes.push({
      entityType: 'pattern',
      entityId: id,
      action: 'update',
      data: { id, ...data, data: (data as { data?: unknown }).data ?? data },
    });
  }

  if (!changes.length) {
    Logger.warn('Nothing to push (no pages or JSON declarations found).');
    return;
  }

  if (dryRun) {
    const pages = changes.filter((c) => c.entityType === 'page');
    const components = changes.filter((c) => c.entityType === 'component');
    const patterns = changes.filter((c) => c.entityType === 'pattern');
    Logger.log('');
    Logger.info(`Dry run: would push ${changes.length} change(s) (no request sent).`);
    Logger.log(`  Pages: ${pages.length}`);
    Logger.log(`  Components: ${components.length}`);
    Logger.log(`  Patterns: ${patterns.length}`);
    if (handoff.debug) {
      for (const c of changes) {
        Logger.debug(`  - ${c.entityType} ${c.entityId} (${c.action})`);
      }
    }
    Logger.log('');
    return;
  }

  const url = `${baseUrl}/api/sync/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes } as SyncUploadBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync push failed (${res.status}): ${text || res.statusText}`);
  }

  const body = (await res.json()) as { appliedCount?: number };
  Logger.success(`Push complete: ${body.appliedCount ?? changes.length} change(s) applied on server.`);
}
