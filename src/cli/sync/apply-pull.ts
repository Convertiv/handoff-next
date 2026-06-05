import { existsSync } from 'fs';
import matter from 'gray-matter';
import fs from 'fs-extra';
import path from 'path';
import type { SyncChange, SyncChangeset } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { entryStubFilesForRenderer, inferProjectRenderer } from '@handoff/declarations/codegen.js';
import { sha256File, sha256String } from './hash.js';
import { entityKey, type EntityFingerprint, type HandoffSyncStateFile } from './sync-state.js';
import { Logger } from '@handoff/utils/logger';
import {
  buildDeclarationPullContent,
  writeBuildArtifactsFromPayload,
} from './apply-declaration-pull.js';

export type PullSummary = {
  written: string[];
  conflicts: string[];
  deleted: string[];
  skipped: string[];
};

function conflictsDir(workPath: string): string {
  return path.join(workPath, '.handoff', 'conflicts');
}

function safeConflictName(entityType: string, entityId: string, ext: string): string {
  const key = `${entityType}__${entityId}`.replace(/[/\\]/g, '_');
  return `${key}${ext}`;
}

function relativeToWork(workPath: string, abs: string): string {
  return path.relative(workPath, abs).split(path.sep).join('/');
}

async function hasLocalModification(
  workPath: string,
  absTarget: string,
  fp: Record<string, EntityFingerprint>,
  key: string
): Promise<boolean> {
  const prev = fp[key];
  const current = await sha256File(absTarget);
  if (!current) return false;
  if (!prev) return false;
  return current !== prev.sha256;
}

async function writeConflictRemote(workPath: string, entityType: string, entityId: string, body: string, ext: string) {
  const dir = conflictsDir(workPath);
  await fs.mkdirp(dir);
  const name = safeConflictName(entityType, entityId, ext);
  await fs.writeFile(path.join(dir, name), body, 'utf8');
}

/**
 * Apply a single remote change with local-wins conflict detection.
 */
export async function applySyncChange(
  handoff: Handoff,
  change: SyncChange,
  fp: Record<string, EntityFingerprint>,
  dryRun = false
): Promise<{ ok: true; kind: 'written' | 'deleted' | 'skipped' } | { ok: false; conflict: true }> {
  const workPath = handoff.workingPath;
  const key = entityKey(change.entityType, change.entityId);

  if (change.entityType === 'page') {
    const d = (change.data ?? {}) as { slug?: string; frontmatter?: Record<string, unknown>; markdown?: string };
    const slug = String(d.slug ?? change.entityId);
    const rel = path.join('pages', `${slug}.md`).split(path.sep).join('/');
    const abs = path.join(workPath, 'pages', `${slug}.md`);

    if (change.action === 'delete') {
      const prev = fp[key];
      const target = prev ? path.join(workPath, prev.relativePath) : abs;
      if (await fs.pathExists(target)) {
        if (await hasLocalModification(workPath, target, fp, key)) {
          if (!dryRun) {
            const content = await fs.readFile(target, 'utf8');
            await writeConflictRemote(workPath, 'page', slug, content, '.local.md');
          }
          return { ok: false, conflict: true };
        }
        if (!dryRun) await fs.remove(target);
      }
      delete fp[key];
      return { ok: true, kind: 'deleted' };
    }

    if ((await fs.pathExists(abs)) && (await hasLocalModification(workPath, abs, fp, key))) {
      if (!dryRun) {
        const remoteBody = matter.stringify(String(d.markdown ?? ''), (d.frontmatter ?? {}) as Record<string, unknown>);
        await writeConflictRemote(workPath, 'page', slug, remoteBody, '.remote.md');
      }
      return { ok: false, conflict: true };
    }

    const out = matter.stringify(String(d.markdown ?? ''), (d.frontmatter ?? {}) as Record<string, unknown>);
    const hash = sha256String(out);
    if (!dryRun) {
      await fs.mkdirp(path.dirname(abs));
      await fs.writeFile(abs, out, 'utf8');
    }
    const contentHash = dryRun ? hash : ((await sha256File(abs)) ?? hash);
    fp[key] = { relativePath: rel, sha256: contentHash };
    return { ok: true, kind: 'written' };
  }

  if (change.entityType === 'component' || change.entityType === 'pattern') {
    const kind = change.entityType === 'component' ? 'component' : 'pattern';
    const payload = (change.data ?? {}) as Record<string, unknown>;

    if (change.action === 'delete') {
      const prev = fp[key];
      const target = prev ? path.join(workPath, prev.relativePath) : null;
      if (target && (await fs.pathExists(target))) {
        if (await hasLocalModification(workPath, target, fp, key)) {
          if (!dryRun) {
            const content = await fs.readFile(target, 'utf8');
            await writeConflictRemote(workPath, change.entityType, change.entityId, content, '.local.ts');
          }
          return { ok: false, conflict: true };
        }
        if (!dryRun) await fs.remove(target);
      }
      delete fp[key];
      return { ok: true, kind: 'deleted' };
    }

    const built = await buildDeclarationPullContent(handoff, kind, change.entityId, payload);
    const bodyWithNl = `${built.content}\n`;
    const hash = sha256String(bodyWithNl);
    const rel = relativeToWork(workPath, built.absPath);

    if ((await fs.pathExists(built.absPath)) && (await hasLocalModification(workPath, built.absPath, fp, key))) {
      if (!dryRun) {
        await writeConflictRemote(workPath, change.entityType, change.entityId, bodyWithNl, '.remote.ts');
      }
      return { ok: false, conflict: true };
    }

    if (!dryRun) {
      await fs.mkdirp(path.dirname(built.absPath));
      await fs.writeFile(built.absPath, bodyWithNl, 'utf8');
      if (kind === 'component' && built.wroteEntryStubs.length) {
        const dir = path.dirname(built.absPath);
        const renderer = inferProjectRenderer(
          handoff.runtimeConfig?.entries?.components ?? {},
          String(payload.renderer ?? '')
        );
        const stubs = entryStubFilesForRenderer(change.entityId, renderer);
        for (const name of built.wroteEntryStubs) {
          const stubPath = path.join(dir, name);
          if (!existsSync(stubPath)) {
            await fs.writeFile(stubPath, stubs[name] ?? '', 'utf8');
          }
        }
      }
      await writeBuildArtifactsFromPayload(handoff, kind, change.entityId, payload, false);
      // Write source files pulled from registry (skip files with local modifications)
      if (kind === 'component' && payload.sourceFiles && typeof payload.sourceFiles === 'object') {
        const componentDir = path.join(handoff.workingPath, 'components', change.entityId);
        for (const [fileName, content] of Object.entries(payload.sourceFiles as Record<string, string>)) {
          if (typeof content !== 'string') continue;
          const abs = path.join(componentDir, fileName);
          const srcKey = entityKey('component-source', `${change.entityId}/${fileName}`);
          if (existsSync(abs) && (await hasLocalModification(workPath, abs, fp, srcKey))) {
            Logger.warn(`Pull: skipping ${fileName} for "${change.entityId}" — local modifications detected.`);
            continue;
          }
          await fs.mkdirp(componentDir);
          await fs.writeFile(abs, content, 'utf8');
        }
      }
    }

    const contentHash = dryRun ? hash : ((await sha256File(built.absPath)) ?? hash);
    fp[key] = { relativePath: rel, sha256: contentHash };
    return { ok: true, kind: 'written' };
  }

  return { ok: true, kind: 'skipped' };
}

export type ApplySyncChangesetOptions = {
  /** When true, no files or conflict artifacts are written and sync state is not updated. */
  dryRun?: boolean;
};

export async function applySyncChangeset(
  handoff: Handoff,
  changeset: SyncChangeset,
  state: HandoffSyncStateFile,
  opts?: ApplySyncChangesetOptions
): Promise<PullSummary> {
  const dryRun = Boolean(opts?.dryRun);
  const summary: PullSummary = { written: [], conflicts: [], deleted: [], skipped: [] };
  const fp = { ...state.fingerprints };

  for (const ch of changeset.changes) {
    const res = await applySyncChange(handoff, ch, fp, dryRun);
    if (!res.ok) {
      summary.conflicts.push(`${ch.entityType}:${ch.entityId}`);
      Logger.warn(
        dryRun
          ? `Conflict (dry run): remote change for ${ch.entityType} "${ch.entityId}" would write under .handoff/conflicts/`
          : `Conflict: remote change for ${ch.entityType} "${ch.entityId}" was written under .handoff/conflicts/`
      );
      continue;
    }
    if (res.kind === 'written') summary.written.push(`${ch.entityType}:${ch.entityId}`);
    else if (res.kind === 'deleted') summary.deleted.push(`${ch.entityType}:${ch.entityId}`);
    else summary.skipped.push(`${ch.entityType}:${ch.entityId}`);
  }

  if (!dryRun) {
    state.fingerprints = fp;
    state.lastSyncVersion = changeset.version;
    state.lastSyncAt = new Date().toISOString();
  }
  return summary;
}
