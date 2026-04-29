import type { ComponentListObject } from '@handoff/transformers/preview/types';
import fs from 'fs-extra';
import path from 'path';
import { createRequire } from 'module';
import { eq } from 'drizzle-orm';
import { isValidComponentId } from '../component-id';
import { getDb } from '../db';
import { insertSyncEvent } from '../db/sync-queries';
import { editHistory, handoffComponents } from '../db/schema';
import { getHandoffRepoRoot, loadHandoffConfigFile, resolveComponentEntryDirs } from './handoff-config-load';

export type IngestedComponentPayload = ComponentListObject;

export type IngestResult = {
  id: string;
  payload: IngestedComponentPayload;
  manifestPath: string;
};

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function resolveManifestPath(componentDir: string): string | null {
  const base = path.basename(componentDir);
  const primary = path.join(componentDir, `${base}.js`);
  if (fs.existsSync(primary)) return primary;
  const jsFiles = fs
    .readdirSync(componentDir)
    .filter((f) => f.endsWith('.js') && f !== 'script.js' && !f.endsWith('.client.js'));
  if (jsFiles.length === 1) return path.join(componentDir, jsFiles[0]);
  return null;
}

function loadManifestObject(manifestPath: string): Record<string, unknown> {
  const req = createRequire(path.join(getHandoffRepoRoot(), 'package.json'));
  const resolved = req.resolve(manifestPath);
  delete req.cache[resolved];
  const mod = req(manifestPath) as Record<string, unknown> | { default?: Record<string, unknown> };
  const raw = (mod as { default?: Record<string, unknown> }).default ?? mod;
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid manifest export: ${manifestPath}`);
  return raw as Record<string, unknown>;
}

function readEntryFile(componentDir: string, rel: string | undefined): string | undefined {
  if (!rel || typeof rel !== 'string') return undefined;
  const abs = path.resolve(componentDir, rel);
  const relNorm = path.relative(componentDir, abs);
  if (relNorm.startsWith('..') || path.isAbsolute(relNorm)) return undefined;
  if (!fs.existsSync(abs)) return undefined;
  return readUtf8(abs);
}

/**
 * Build a `ComponentListObject` from a legacy on-disk component folder.
 */
export function ingestComponentDir(componentDir: string): IngestResult {
  if (!fs.statSync(componentDir).isDirectory()) {
    throw new Error(`Not a directory: ${componentDir}`);
  }
  const manifestPath = resolveManifestPath(componentDir);
  if (!manifestPath) {
    throw new Error(`No component manifest (.js) found in ${componentDir}`);
  }
  const m = loadManifestObject(manifestPath);
  const id = String(m.id ?? path.basename(componentDir)).trim();
  if (!id) throw new Error(`Missing component id in ${manifestPath}`);
  if (!isValidComponentId(id)) {
    throw new Error(`Invalid component id "${id}" (allowed: lowercase letters, numbers, hyphens, underscores)`);
  }

  const entries = m.entries && typeof m.entries === 'object' && !Array.isArray(m.entries) ? (m.entries as Record<string, string>) : {};
  const template = readEntryFile(componentDir, entries.template);
  const scss = readEntryFile(componentDir, entries.scss);
  const js = readEntryFile(componentDir, entries.js);
  const component = readEntryFile(componentDir, entries.component);
  const story = readEntryFile(componentDir, entries.story);

  const renderer = (m.renderer as 'handlebars' | 'react' | 'csf' | undefined) ?? 'handlebars';
  const title = String(m.title ?? m.name ?? id);
  const description = String(m.description ?? '');
  const group = String(m.group ?? '');
  const image = String(m.image ?? '');
  const type = String(m.type ?? 'element');

  const entrySources: Record<string, string> = {};
  if (renderer === 'handlebars') {
    if (template) entrySources.template = template;
    if (scss) entrySources.scss = scss;
    if (js) entrySources.js = js;
  } else if (renderer === 'react') {
    if (component) entrySources.component = component;
    if (scss) entrySources.scss = scss;
    if (js) entrySources.js = js;
  } else if (renderer === 'csf') {
    if (story) entrySources.story = story;
    if (scss) entrySources.scss = scss;
    if (js) entrySources.js = js;
  }

  const payload = {
    id,
    path: `/system/component/${id}/`,
    title,
    description,
    group,
    image,
    type,
    renderer,
    categories: Array.isArray(m.categories) ? m.categories : [],
    tags: Array.isArray(m.tags) ? m.tags : [],
    should_do: Array.isArray(m.should_do) ? m.should_do : [],
    should_not_do: Array.isArray(m.should_not_do) ? m.should_not_do : [],
    figma: typeof m.figma === 'string' ? m.figma : undefined,
    figmaComponentId: typeof m.figmaComponentId === 'string' ? m.figmaComponentId : undefined,
    options: m.options && typeof m.options === 'object' ? m.options : undefined,
    page: m.page && typeof m.page === 'object' ? m.page : undefined,
    properties: m.properties && typeof m.properties === 'object' && !Array.isArray(m.properties) ? m.properties : {},
    previews: m.previews && typeof m.previews === 'object' && !Array.isArray(m.previews) ? m.previews : {},
    entries,
    entrySources,
  } as unknown as IngestedComponentPayload;

  return { id, payload, manifestPath };
}

/**
 * List immediate subdirectories of each root that contain a valid manifest.
 */
export function discoverFilesystemComponents(rootDirs: string[]): string[] {
  const dirs: string[] = [];
  for (const root of rootDirs) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (!fs.statSync(full).isDirectory()) continue;
      if (resolveManifestPath(full)) dirs.push(full);
    }
  }
  return dirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export function ingestAllFromConfig(): IngestResult[] {
  const loaded = loadHandoffConfigFile();
  const roots = resolveComponentEntryDirs(loaded?.config ?? null);
  return discoverFilesystemComponents(roots).map((d) => ingestComponentDir(d));
}

export type IngestDecision = 'skip' | 'filesystem' | 'keep_db';

export type UpsertIngestOptions = {
  userId: string | null;
  /** For `edit_history.user_id` — must be a real `user.id` or null (FK). */
  historyUserId: string | null;
  /** Per component id: only ingest when 'filesystem' or new; skip when 'skip'; 'keep_db' leaves row unchanged */
  decisions?: Record<string, IngestDecision>;
};

/**
 * Insert or update `handoff_component` from ingest payloads; records edit history + sync events.
 */
export async function upsertIngestedComponents(
  results: IngestResult[],
  opts: UpsertIngestOptions
): Promise<{ ingested: string[]; skipped: string[]; kept: string[] }> {
  const db = getDb();
  if (!db) throw new Error('Database unavailable');

  const ingested: string[] = [];
  const skipped: string[] = [];
  const kept: string[] = [];

  for (const { id, payload } of results) {
    const decision = opts.decisions?.[id] ?? 'filesystem';
    if (decision === 'skip') {
      skipped.push(id);
      continue;
    }
    if (decision === 'keep_db') {
      kept.push(id);
      continue;
    }

    const [existing] = await db.select({ id: handoffComponents.id }).from(handoffComponents).where(eq(handoffComponents.id, id)).limit(1);
    const isNew = !existing;

    const row = {
      id,
      path: payload.path,
      title: payload.title,
      description: payload.description ?? '',
      group: payload.group ?? '',
      image: payload.image ?? '',
      type: payload.type ?? 'element',
      properties: payload.properties as Record<string, unknown> | null,
      previews: payload.previews as Record<string, unknown> | null,
      data: payload as unknown as Record<string, unknown>,
      source: 'disk' as const,
      updatedAt: new Date(),
    };

    await db
      .insert(handoffComponents)
      .values({
        ...row,
      })
      .onConflictDoUpdate({
        target: handoffComponents.id,
        set: {
          path: row.path,
          title: row.title,
          description: row.description,
          group: row.group,
          image: row.image,
          type: row.type,
          properties: row.properties,
          previews: row.previews,
          data: row.data,
          source: 'disk',
          updatedAt: new Date(),
        },
      });

    await db.insert(editHistory).values({
      entityType: 'component',
      entityId: id,
      userId: opts.historyUserId,
      diff: { action: isNew ? 'ingest_create' : 'ingest_update', source: 'filesystem' },
    });

    await insertSyncEvent({
      entityType: 'component',
      entityId: id,
      action: isNew ? 'create' : 'update',
      payload: { id, ...row, data: payload } as Record<string, unknown>,
      userId: opts.userId,
    });

    ingested.push(id);
  }

  return { ingested, skipped, kept };
}
