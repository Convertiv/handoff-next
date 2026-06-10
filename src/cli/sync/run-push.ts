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
  // Screenshots and validators share a single headless Chromium process that
  // is opened lazily on the first call to getSharedBrowser(). We MUST close
  // it before returning; otherwise Node.js keeps the chromium child process
  // alive and the CLI hangs indefinitely after "Push complete."
  try {
    await _runPushInner(handoff, opts);
  } finally {
    const { closeSharedBrowser } = await import('@handoff/transformers/preview/component/playwright-shared');
    await closeSharedBrowser();
  }
}

async function _runPushInner(handoff: Handoff, opts?: RunPushOptions): Promise<void> {
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
  let sharedAttached = false;

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
        // Attach shared assets (main.js, main.css, shared.css — easily 1MB+)
        // to ONLY the first component change. Subsequent changes don't need
        // to resend the same bundle; the server already has it after the
        // first push. Cuts per-component payload from ~2MB to ~500KB.
        const sharedForThis = sharedAttached ? undefined : sharedAssets;
        payload = attachArtifacts(payload, collected.files, sharedForThis) as ComponentSyncData;
        if (sharedAssets && Object.keys(sharedAssets).length > 0) sharedAttached = true;
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

  // Auto-batch changes so each HTTP request stays under Vercel's 4.5MB
  // serverless-function body limit. We target 3MB per batch (with comfortable
  // headroom for the JSON wrapper and HTTP headers).
  //
  // Individual components can still exceed the batch limit when they carry
  // large artifact files (e.g. a React component-library JS bundle).  We
  // handle this with a three-level safeguard:
  //
  //   1. (Selective strip) Strip individual artifact files that exceed
  //      MAX_ARTIFACT_FILE_BYTES from buildArtifacts, keeping small files
  //      (CSS, screenshots, HTML previews, JSON).  This lets metadata +
  //      previews push even when the JS bundle alone is 3+ MB.
  //
  //   2. (Full strip) If the item is still over MAX_ITEM_BYTES after selective
  //      stripping, strip ALL buildArtifacts.  Metadata + source files still push.
  //
  //   3. (Skip) If the item is still over MAX_ITEM_BYTES after full stripping
  //      (e.g. enormous source files), skip it entirely so one bad component
  //      never blocks the rest of the push.
  const url = `${baseUrl}/api/sync/upload`;
  const MAX_BATCH_BYTES        = 3 * 1024 * 1024;  // 3 MB per batch
  const MAX_ITEM_BYTES         = 3 * 1024 * 1024;  // 3 MB per single change (must fit in one batch)
  const MAX_ARTIFACT_FILE_BYTES = 1 * 1024 * 1024; // 1 MB per individual artifact file
  const batches: SyncUploadBody['changes'][] = [];
  let current: SyncUploadBody['changes'] = [];
  let currentBytes = 0;

  for (let change of changes) {
    let changeBytes = Buffer.byteLength(JSON.stringify(change), 'utf8');

    // ── Per-item oversize guard ──────────────────────────────────────────────
    if (changeBytes > MAX_ITEM_BYTES) {
      const dataObj = change.data as Record<string, unknown>;
      const artifacts = dataObj?.buildArtifacts;

      // Level 1: Selectively strip oversized individual artifact files.
      // Keeps small files (HTML previews, screenshots, CSS) while dropping
      // large JS bundles (e.g. a 3 MB React component-library bundle).
      if (artifacts && typeof artifacts === 'object' && !Array.isArray(artifacts)) {
        const slimArtifacts: Record<string, string> = {};
        const strippedFiles: string[] = [];
        for (const [filename, content] of Object.entries(artifacts as Record<string, string>)) {
          const fileBytes = Buffer.byteLength(content, 'utf8');
          if (fileBytes > MAX_ARTIFACT_FILE_BYTES) {
            strippedFiles.push(`${filename} (${(fileBytes / (1024 * 1024)).toFixed(1)}MB)`);
          } else {
            slimArtifacts[filename] = content;
          }
        }
        if (strippedFiles.length > 0) {
          Logger.warn(
            `Component "${change.entityId}": stripping ${strippedFiles.length} oversized artifact(s) ` +
            `(>${(MAX_ARTIFACT_FILE_BYTES / (1024 * 1024)).toFixed(0)}MB each): ${strippedFiles.join(', ')}. ` +
            `Metadata, HTML previews, screenshots and CSS will still push.`
          );
          change = { ...change, data: { ...dataObj, buildArtifacts: slimArtifacts } };
          changeBytes = Buffer.byteLength(JSON.stringify(change), 'utf8');
        }
      }

      // Level 2: Still over limit — drop ALL buildArtifacts.
      if (changeBytes > MAX_ITEM_BYTES) {
        const sizeMb = (changeBytes / (1024 * 1024)).toFixed(1);
        const hasArtifacts =
          change.entityType === 'component' &&
          !!(change.data as Record<string, unknown>)?.buildArtifacts;

        if (hasArtifacts) {
          Logger.warn(
            `Component "${change.entityId}" payload is ${sizeMb}MB even after selective artifact stripping. ` +
            `Stripping all buildArtifacts — metadata + source files still push. ` +
            `To avoid this, reduce preview variant count or set \`metadataOnly: true\`.`
          );
          const { buildArtifacts: _dropped, ...dataWithout } = change.data as Record<string, unknown>;
          change = { ...change, data: dataWithout };
          changeBytes = Buffer.byteLength(JSON.stringify(change), 'utf8');
        }
      }

      // Level 3: Still too large — skip to avoid a guaranteed 413.
      if (changeBytes > MAX_ITEM_BYTES) {
        const sizeMb2 = (changeBytes / (1024 * 1024)).toFixed(1);
        Logger.error(
          `Component "${change.entityId}" payload is ${sizeMb2}MB even after stripping buildArtifacts. ` +
          `Skipping this component — use \`handoff-app push --metadata-only --component ${change.entityId}\` ` +
          `to push just its metadata.`
        );
        continue;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if (current.length > 0 && currentBytes + changeBytes > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(change);
    currentBytes += changeBytes;
  }
  if (current.length > 0) batches.push(current);

  if (batches.length > 1) {
    Logger.info(`Splitting ${changes.length} changes into ${batches.length} batches (server body-size limit).`);
  }

  let totalApplied = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchBytes = Buffer.byteLength(JSON.stringify({ changes: batch }), 'utf8');
    Logger.info(`Pushing batch ${i + 1}/${batches.length}: ${batch.length} change(s), ${Math.round(batchBytes / 1024)}KB`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: batch } as SyncUploadBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Sync push failed on batch ${i + 1}/${batches.length} (${res.status}): ${text || res.statusText}`
      );
    }

    const body = (await res.json()) as { appliedCount?: number };
    totalApplied += body.appliedCount ?? batch.length;
  }

  Logger.success(`Push complete: ${totalApplied} change(s) applied on server across ${batches.length} batch(es).`);
}
