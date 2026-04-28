import { existsSync } from 'fs';
import matter from 'gray-matter';
import fs from 'fs-extra';
import path from 'path';
import type { SyncChange, SyncChangeset } from '../../types/handoff-sync';
import type Handoff from '../../index';
import { sha256File, sha256String } from './hash';
import { entityKey, type EntityFingerprint, type HandoffSyncStateFile } from './sync-state';
import { getDeclarationAbsPathForEntity } from './resolve-declaration';
import { Logger } from '../../utils/logger';

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

function dirHasDeclarationForBase(dir: string, base: string): boolean {
  const modern = (['ts', 'js', 'cjs', 'json'] as const).map((ext) => path.join(dir, `${base}.handoff.${ext}`));
  if (modern.some((p) => existsSync(p))) return true;
  return existsSync(path.join(dir, `${base}.json`)) || existsSync(path.join(dir, `${base}.js`)) || existsSync(path.join(dir, `${base}.cjs`));
}

/**
 * Directory for a component/pattern id when there is no existing declaration (remote create).
 */
function resolveEntityDir(handoff: Handoff, kind: 'component' | 'pattern', entityId: string): string {
  const existing = getDeclarationAbsPathForEntity(handoff, kind, entityId);
  if (existing) return path.dirname(existing);

  const entries =
    kind === 'component' ? handoff.config?.entries?.components : handoff.config?.entries?.patterns;
  const first = entries?.[0];
  if (!first) {
    return path.join(handoff.workingPath, kind === 'component' ? 'components' : 'patterns', entityId);
  }

  const resolved = path.resolve(handoff.workingPath, first);
  const base = path.basename(resolved);
  if (base === entityId) {
    return resolved;
  }
  if (dirHasDeclarationForBase(resolved, base)) {
    return path.join(path.dirname(resolved), entityId);
  }
  return path.join(resolved, entityId);
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
  fp: Record<string, EntityFingerprint>
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
          const content = await fs.readFile(target, 'utf8');
          await writeConflictRemote(workPath, 'page', slug, content, '.local.md');
          return { ok: false, conflict: true };
        }
        await fs.remove(target);
      }
      delete fp[key];
      return { ok: true, kind: 'deleted' };
    }

    if ((await fs.pathExists(abs)) && (await hasLocalModification(workPath, abs, fp, key))) {
      const remoteBody = matter.stringify(String(d.markdown ?? ''), (d.frontmatter ?? {}) as Record<string, unknown>);
      await writeConflictRemote(workPath, 'page', slug, remoteBody, '.remote.md');
      return { ok: false, conflict: true };
    }

    await fs.mkdirp(path.dirname(abs));
    const out = matter.stringify(String(d.markdown ?? ''), (d.frontmatter ?? {}) as Record<string, unknown>);
    await fs.writeFile(abs, out, 'utf8');
    const hash = (await sha256File(abs)) ?? sha256String(out);
    fp[key] = { relativePath: rel, sha256: hash };
    return { ok: true, kind: 'written' };
  }

  if (change.entityType === 'component' || change.entityType === 'pattern') {
    const kind = change.entityType === 'component' ? 'component' : 'pattern';
    const dir = resolveEntityDir(handoff, kind, change.entityId);
    const jsonName = `${change.entityId}.handoff.json`;
    const abs = path.join(dir, jsonName);
    const rel = relativeToWork(workPath, abs);

    if (change.action === 'delete') {
      const prev = fp[key];
      const target = prev ? path.join(workPath, prev.relativePath) : abs;
      if (await fs.pathExists(target)) {
        if (await hasLocalModification(workPath, target, fp, key)) {
          const content = await fs.readFile(target, 'utf8');
          await writeConflictRemote(workPath, change.entityType, change.entityId, content, '.local.json');
          return { ok: false, conflict: true };
        }
        await fs.remove(target);
      }
      delete fp[key];
      return { ok: true, kind: 'deleted' };
    }

    const payload = (change.data ?? {}) as Record<string, unknown>;
    const jsonBody = JSON.stringify(payload, null, 2);

    if ((await fs.pathExists(abs)) && (await hasLocalModification(workPath, abs, fp, key))) {
      await writeConflictRemote(workPath, change.entityType, change.entityId, jsonBody, '.remote.json');
      return { ok: false, conflict: true };
    }

    await fs.mkdirp(dir);
    await fs.writeFile(abs, `${jsonBody}\n`, 'utf8');
    const hash = (await sha256File(abs)) ?? sha256String(`${jsonBody}\n`);
    fp[key] = { relativePath: rel, sha256: hash };
    return { ok: true, kind: 'written' };
  }

  return { ok: true, kind: 'skipped' };
}

export async function applySyncChangeset(handoff: Handoff, changeset: SyncChangeset, state: HandoffSyncStateFile): Promise<PullSummary> {
  const summary: PullSummary = { written: [], conflicts: [], deleted: [], skipped: [] };
  const fp = { ...state.fingerprints };

  for (const ch of changeset.changes) {
    const res = await applySyncChange(handoff, ch, fp);
    if (!res.ok) {
      summary.conflicts.push(`${ch.entityType}:${ch.entityId}`);
      Logger.warn(`Conflict: remote change for ${ch.entityType} "${ch.entityId}" was written under .handoff/conflicts/`);
      continue;
    }
    if (res.kind === 'written') summary.written.push(`${ch.entityType}:${ch.entityId}`);
    else if (res.kind === 'deleted') summary.deleted.push(`${ch.entityType}:${ch.entityId}`);
    else summary.skipped.push(`${ch.entityType}:${ch.entityId}`);
  }

  state.fingerprints = fp;
  state.lastSyncVersion = changeset.version;
  state.lastSyncAt = new Date().toISOString();
  return summary;
}
