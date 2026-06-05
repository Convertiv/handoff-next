import { buildPatterns } from '@handoff/pipeline/patterns.js';
import matter from 'gray-matter';
import fs from 'fs-extra';
import path from 'path';
import type { ComponentSyncData, PatternSyncData, SyncUploadBody } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import {
  collectComponentBuildArtifacts,
  collectComponentSourceFiles,
  collectPatternBuildArtifacts,
  collectSharedComponentAssets,
} from './collect-build-artifacts.js';
import {
  resolveComponentDeclarationForSync,
  resolvePatternDeclarationForSync,
} from './resolve-declaration-payload.js';
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

export type RunPushOptions = {
  /** When set and non-empty, only these component ids are pushed (must exist in config). */
  componentIds?: string[];
  /** When set and non-empty, only these pattern ids are pushed (must exist in config). */
  patternIds?: string[];
  /** When set and non-empty, only these page slugs are pushed (paths under `pages/` without `.md`, e.g. `about` or `guides/colors`). */
  pageSlugs?: string[];
  /** List changes that would be uploaded without calling the remote API (no HANDOFF_CLOUD_* required). */
  dryRun?: boolean;
  /** Run local component/pattern build before collecting artifacts (default true when pushing components/patterns). */
  build?: boolean;
  /** Skip build artifacts; upload declaration metadata only. */
  metadataOnly?: boolean;
  /** Skip build step; upload existing artifacts only. */
  noBuild?: boolean;
};

function normalizePageSlug(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function shouldRunBuild(opts: RunPushOptions | undefined, pushingComponentsOrPatterns: boolean): boolean {
  if (opts?.metadataOnly) return false;
  if (opts?.noBuild) return false;
  if (!pushingComponentsOrPatterns) return false;
  if (opts?.build === false) return false;
  return true;
}

async function buildEntity(handoff: Handoff, kind: 'component' | 'pattern', id: string): Promise<void> {
  if (kind === 'component') {
    await handoff.component(id);
    return;
  }
  await buildPatterns(handoff, { onlyPatternIds: new Set([id]) });
}

function attachArtifacts(
  data: ComponentSyncData | PatternSyncData,
  files: Record<string, string>,
  shared?: Record<string, string>
): ComponentSyncData | PatternSyncData {
  const buildArtifacts = { ...shared, ...files };
  if (Object.keys(buildArtifacts).length === 0) return data;
  return { ...data, buildArtifacts };
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

  const configuredPatIds = Object.keys(handoff.runtimeConfig?.entries?.patterns ?? {});
  const pushingEntities = compIdsToScan.length > 0 || (selective ? (opts?.patternIds?.length ?? 0) > 0 : configuredPatIds.length > 0);
  const runBuild = shouldRunBuild(opts, pushingEntities);
  let sharedAssets: Record<string, string> | undefined;

  for (const id of compIdsToScan) {
    if (!configuredCompIds.includes(id)) continue;
    try {
      if (runBuild) {
        Logger.info(`Building component "${id}"…`);
        await buildEntity(handoff, 'component', id);
      }
      let payload = await resolveComponentDeclarationForSync(handoff, id, {
        warnMissingArtifacts: !opts?.metadataOnly,
      });
      if (!payload) {
        Logger.warn(`Skipping component "${id}" (no declaration file found in config).`);
        continue;
      }
      if (!opts?.metadataOnly) {
        const collected = await collectComponentBuildArtifacts(handoff, id);
        for (const w of collected.warnings) Logger.warn(w);
        if (!sharedAssets && Object.keys(collected.files).length > 0) {
          sharedAssets = await collectSharedComponentAssets(handoff);
        }
        payload = attachArtifacts(payload, collected.files, sharedAssets) as ComponentSyncData;
        const sourceFiles = await collectComponentSourceFiles(handoff, id);
        if (Object.keys(sourceFiles).length > 0) {
          payload = { ...payload, sourceFiles };
        }
      }
      payload = {
        ...payload,
        changeType: opts?.metadataOnly ? 'metadata_updated' : 'full',
      } as ComponentSyncData;
      changes.push({
        entityType: 'component',
        entityId: id,
        action: 'update',
        data: { ...payload, source: 'sync' },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`Component "${id}": ${msg}`);
    }
  }

  const patIdsToScan = selective ? (opts?.patternIds?.length ? opts.patternIds : []) : configuredPatIds;
  if (selective && opts?.patternIds?.length) {
    const set = new Set(configuredPatIds);
    for (const id of opts.patternIds) {
      if (!set.has(id)) Logger.warn(`Pattern "${id}" is not in handoff.config entries.patterns — skipped.`);
    }
  }
  for (const id of patIdsToScan) {
    if (!configuredPatIds.includes(id)) continue;
    try {
      if (runBuild) {
        Logger.info(`Building pattern "${id}"…`);
        await buildEntity(handoff, 'pattern', id);
      }
      let payload = await resolvePatternDeclarationForSync(handoff, id);
      if (!payload) {
        Logger.warn(`Skipping pattern "${id}" (no declaration file found in config).`);
        continue;
      }
      if (!opts?.metadataOnly) {
        const collected = await collectPatternBuildArtifacts(handoff, id);
        for (const w of collected.warnings) Logger.warn(w);
        payload = attachArtifacts(payload, collected.files) as PatternSyncData;
      }
      changes.push({
        entityType: 'pattern',
        entityId: id,
        action: 'update',
        data: { ...payload, source: 'sync' },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`Pattern "${id}": ${msg}`);
    }
  }

  if (!changes.length) {
    Logger.warn('Nothing to push (no pages or resolvable declarations found).');
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
        const art = (c.data as { buildArtifacts?: Record<string, string> })?.buildArtifacts;
        const artCount = art ? Object.keys(art).length : 0;
        Logger.debug(`  - ${c.entityType} ${c.entityId} (${c.action})${artCount ? ` [${artCount} artifacts]` : ''}`);
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
