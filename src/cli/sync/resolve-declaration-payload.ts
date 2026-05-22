import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'path';
import { evaluateTypeScriptDeclaration } from '@handoff/config/declaration-module-load.js';
import { normalizeComponentDeclaration } from '@handoff/config/normalizers/declaration.js';
import { normalizePatternDeclaration } from '@handoff/config/normalizers/pattern.js';
import { nestFigmaLinkDataForDeclarationFile } from '@handoff/figma/component-linking';
import type { ComponentSyncData, PatternSyncData } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { getDeclarationAbsPathForEntity } from './resolve-declaration.js';

function toRelativeEntryPath(value: string, declarationDir: string): string {
  if (!value) return value;
  const resolved = path.isAbsolute(value) ? value : path.resolve(declarationDir, value);
  let rel = path.relative(declarationDir, resolved).split(path.sep).join('/');
  if (rel && !rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function toRelativeEntries(entries: Record<string, string | undefined> | undefined, declarationDir: string): Record<string, string> {
  if (!entries) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!value) continue;
    out[key] = toRelativeEntryPath(value, declarationDir);
  }
  return out;
}

function previewsForHandoffConfig(previews: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!previews || typeof previews !== 'object') return previews;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(previews)) {
    if (!val || typeof val !== 'object') {
      out[key] = val;
      continue;
    }
    const p = { ...(val as Record<string, unknown>) };
    if (p.values !== undefined && p.args === undefined) {
      p.args = p.values;
      delete p.values;
    }
    out[key] = p;
  }
  return out;
}

export function rawToHandoffConfig(raw: Record<string, unknown>, declarationPath: string): Record<string, unknown> {
  const declarationDir = path.dirname(declarationPath);
  const config: Record<string, unknown> = { ...raw };
  delete config.default;
  if (config.entries && typeof config.entries === 'object') {
    config.entries = toRelativeEntries(config.entries as Record<string, string | undefined>, declarationDir);
  }
  if (config.previews) {
    config.previews = previewsForHandoffConfig(config.previews as Record<string, unknown>);
  }
  if (typeof config.name !== 'string' && typeof config.title === 'string') {
    config.name = config.title;
  }
  return nestFigmaLinkDataForDeclarationFile(config) as Record<string, unknown>;
}

function loadDeclarationRaw(filePath: string, modulePath: string): Record<string, unknown> {
  if (filePath.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  }
  if (filePath.endsWith('.ts')) {
    const mod = evaluateTypeScriptDeclaration(filePath, modulePath) as { default?: Record<string, unknown> };
    const raw = mod.default ?? (mod as unknown as Record<string, unknown>);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Declaration "${filePath}" did not export a config object.`);
    }
    return raw;
  }
  const req = createRequire(filePath);
  const resolved = req.resolve(filePath);
  delete req.cache[resolved];
  const loaded = req(filePath) as Record<string, unknown> | { default?: Record<string, unknown> };
  const raw = (loaded as { default?: Record<string, unknown> }).default ?? loaded;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Declaration "${filePath}" did not export a config object.`);
  }
  return raw as Record<string, unknown>;
}

async function readBuiltComponentJson(workPath: string, id: string): Promise<Record<string, unknown> | null> {
  const builtPath = path.join(workPath, 'public/api/component', `${id}.json`);
  if (!(await fs.pathExists(builtPath))) return null;
  try {
    return (await fs.readJson(builtPath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolveDeclarationPath(
  handoff: Handoff,
  kind: 'component' | 'pattern',
  id: string
): Promise<{ absPath: string; preferJsonSidecar: boolean } | null> {
  const fromRuntime = getDeclarationAbsPathForEntity(handoff, kind, id);
  if (fromRuntime) {
    const dir = path.dirname(fromRuntime);
    const sidecar = path.join(dir, `${id}.handoff.json`);
    if (await fs.pathExists(sidecar)) {
      return { absPath: sidecar, preferJsonSidecar: true };
    }
    return { absPath: fromRuntime, preferJsonSidecar: false };
  }
  return null;
}

export type ResolveDeclarationOptions = {
  warnMissingArtifacts?: boolean;
};

export async function resolveComponentDeclarationForSync(
  handoff: Handoff,
  id: string,
  opts?: ResolveDeclarationOptions
): Promise<ComponentSyncData | null> {
  const resolved = await resolveDeclarationPath(handoff, 'component', id);
  if (!resolved) return null;

  const { absPath } = resolved;
  let raw: Record<string, unknown>;
  try {
    raw = loadDeclarationRaw(absPath, handoff.modulePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Component "${id}": failed to load declaration at ${absPath}: ${msg}`);
  }

  const normalized = normalizeComponentDeclaration(raw, {
    declarationPath: absPath,
    fallbackId: id,
    warn: (m) => Logger.warn(m),
  });

  const handoffConfig = rawToHandoffConfig(raw, absPath);
  const built = await readBuiltComponentJson(handoff.workingPath, id);
  const data: Record<string, unknown> = {
    ...(built ?? {}),
    ...JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>,
    handoffConfig,
  };

  if (opts?.warnMissingArtifacts !== false && !built && Object.keys(normalized.entries ?? {}).length > 0) {
    Logger.warn(`Component "${id}": no built preview at public/api/component/${id}.json — run build or push with --build for hosted previews.`);
  }

  return {
    id,
    title: normalized.title,
    description: normalized.description,
    group: normalized.group,
    type: normalized.type,
    path: normalized.path,
    image: normalized.image,
    properties: normalized.properties,
    previews: normalized.previews,
    handoffConfig,
    data,
  };
}

export async function resolvePatternDeclarationForSync(
  handoff: Handoff,
  id: string
): Promise<PatternSyncData | null> {
  const resolved = await resolveDeclarationPath(handoff, 'pattern', id);
  if (!resolved) return null;

  const { absPath } = resolved;
  let raw: Record<string, unknown>;
  try {
    raw = loadDeclarationRaw(absPath, handoff.modulePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Pattern "${id}": failed to load declaration at ${absPath}: ${msg}`);
  }

  const normalized = normalizePatternDeclaration(raw, {
    declarationPath: absPath,
    fallbackId: id,
  });

  const handoffConfig = rawToHandoffConfig(raw, absPath);
  const data: Record<string, unknown> = {
    ...JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>,
    handoffConfig,
  };

  return {
    id,
    title: normalized.title,
    description: normalized.description,
    group: normalized.group,
    tags: normalized.tags,
    components: normalized.components,
    handoffConfig,
    data,
  };
}
