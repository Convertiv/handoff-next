import { existsSync } from 'fs';
import fs from 'fs-extra';
import path from 'path';
import { getComponentDistPath } from '@handoff/transformers/preview/component/api.js';
import { evaluateTypeScriptDeclaration } from '@handoff/config/declaration-module-load.js';
import type { RendererKind } from '@handoff/declarations/types.js';
import {
  buildHandoffDeclarationObject,
  buildHandoffDeclarationTsForRenderer,
  buildHandoffPatternDeclarationTs,
  entryStubFilesForRenderer,
  inferProjectRenderer,
  nestConfigForDeclarationFile,
} from '@handoff/declarations/codegen.js';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import {
  mergeRemoteMetadataIntoLocalConfig,
  patchHandoffDeclarationSource,
  remotePayloadToHandoffConfig,
} from './declaration-patch.js';
import { getDeclarationAbsPathForEntity } from './resolve-declaration.js';
import { isBinaryArtifactFilename } from './collect-build-artifacts.js';

function dirHasDeclarationForBase(dir: string, base: string): boolean {
  const modern = (['ts', 'js', 'cjs', 'json'] as const).map((ext) => path.join(dir, `${base}.handoff.${ext}`));
  if (modern.some((p) => existsSync(p))) return true;
  return existsSync(path.join(dir, `${base}.json`)) || existsSync(path.join(dir, `${base}.js`)) || existsSync(path.join(dir, `${base}.cjs`));
}

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

function declarationTsPath(dir: string, id: string): string {
  return path.join(dir, `${id}.handoff.ts`);
}

function loadLocalConfigFromTs(absPath: string, modulePath: string): Record<string, unknown> | null {
  try {
    const mod = evaluateTypeScriptDeclaration(absPath, modulePath) as { default?: Record<string, unknown> };
    const raw = mod.default ?? (mod as unknown as Record<string, unknown>);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function remoteToDeclarationObject(
  remote: Record<string, unknown>,
  id: string,
  renderer: RendererKind
): Record<string, unknown> {
  const title = String(remote.name ?? remote.title ?? id);
  const previewsRaw = remote.previews as Record<string, { title?: string; values?: Record<string, unknown>; args?: Record<string, unknown> }> | undefined;
  const previews = previewsRaw
    ? Object.fromEntries(
        Object.entries(previewsRaw).map(([k, p]) => [
          k,
          { title: p.title ?? k, values: p.values ?? p.args ?? {} },
        ])
      )
    : undefined;

  return buildHandoffDeclarationObject({
    id,
    title,
    description: typeof remote.description === 'string' ? remote.description : '',
    group: typeof remote.group === 'string' ? remote.group : '',
    type: typeof remote.type === 'string' ? remote.type : 'element',
    renderer,
    previews,
    properties: (remote.properties as Record<string, unknown>) ?? undefined,
    image: typeof remote.image === 'string' ? remote.image : undefined,
    tags: Array.isArray(remote.tags) ? (remote.tags as string[]) : undefined,
    categories: Array.isArray(remote.categories) ? (remote.categories as string[]) : undefined,
    shouldDo: (remote.shouldDo as string[]) ?? (remote.should_do as string[]) ?? undefined,
    shouldNotDo: (remote.shouldNotDo as string[]) ?? (remote.should_not_do as string[]) ?? undefined,
    entries: (remote.entries as Record<string, string>) ?? undefined,
  });
}

export type ApplyDeclarationPullResult = {
  absPath: string;
  content: string;
  wroteEntryStubs: string[];
};

export async function buildDeclarationPullContent(
  handoff: Handoff,
  kind: 'component' | 'pattern',
  entityId: string,
  payload: Record<string, unknown>
): Promise<ApplyDeclarationPullResult> {
  const dir = resolveEntityDir(handoff, kind, entityId);
  const tsPath = declarationTsPath(dir, entityId);
  const remoteConfig = remotePayloadToHandoffConfig(payload);
  const existingDecl = getDeclarationAbsPathForEntity(handoff, kind, entityId);
  const wroteEntryStubs: string[] = [];

  if (existingDecl?.endsWith('.handoff.ts') && (await fs.pathExists(existingDecl))) {
    const source = await fs.readFile(existingDecl, 'utf8');
    const localConfig = loadLocalConfigFromTs(existingDecl, handoff.modulePath) ?? {};
    const merged = mergeRemoteMetadataIntoLocalConfig(localConfig, remoteConfig, {
      preserveEntries: true,
      preserveRenderer: true,
    });
    const nested = nestConfigForDeclarationFile(merged);
    const patched = patchHandoffDeclarationSource(source, nested);
    if (patched) {
      return { absPath: existingDecl, content: patched, wroteEntryStubs };
    }
    const renderer = (localConfig.renderer as RendererKind | undefined) ?? inferProjectRenderer(
      handoff.runtimeConfig?.entries?.components ?? {},
      String(remoteConfig.renderer ?? '')
    );
    const regen = kind === 'pattern'
      ? buildHandoffPatternDeclarationTs(nested)
      : buildHandoffDeclarationTsForRenderer(renderer, nested);
    return { absPath: existingDecl, content: regen, wroteEntryStubs };
  }

  if (existingDecl && !existingDecl.endsWith('.handoff.ts')) {
    Logger.warn(
      `${kind} "${entityId}": legacy declaration "${path.basename(existingDecl)}" remains on disk; created ${entityId}.handoff.ts (modern declaration takes precedence at runtime).`
    );
  }

  const renderer =
    kind === 'component'
      ? inferProjectRenderer(
          handoff.runtimeConfig?.entries?.components ?? {},
          String(remoteConfig.renderer ?? payload.renderer ?? '')
        )
      : 'handlebars';

  const declObj =
    kind === 'pattern'
      ? {
          id: entityId,
          name: String(remoteConfig.name ?? remoteConfig.title ?? entityId),
          description: remoteConfig.description ?? '',
          group: remoteConfig.group ?? '',
          components: remoteConfig.components ?? [],
          tags: remoteConfig.tags,
        }
      : remoteToDeclarationObject(remoteConfig, entityId, renderer as RendererKind);

  const nested = nestConfigForDeclarationFile(declObj as Record<string, unknown>);
  const content =
    kind === 'pattern'
      ? buildHandoffPatternDeclarationTs(nested)
      : buildHandoffDeclarationTsForRenderer(renderer as RendererKind, nested);

  if (kind === 'component') {
    const stubs = entryStubFilesForRenderer(entityId, renderer as RendererKind);
    for (const [name, stubContent] of Object.entries(stubs)) {
      const stubPath = path.join(dir, name);
      if (!(await fs.pathExists(stubPath))) {
        wroteEntryStubs.push(name);
      }
    }
  }

  return { absPath: tsPath, content, wroteEntryStubs };
}

export async function writeDeclarationPullArtifacts(
  handoff: Handoff,
  kind: 'component' | 'pattern',
  entityId: string,
  payload: Record<string, unknown>,
  dryRun: boolean
): Promise<{ wroteEntryStubs: string[] }> {
  const built = await buildDeclarationPullContent(handoff, kind, entityId, payload);
  if (!dryRun) {
    await fs.mkdirp(path.dirname(built.absPath));
    await fs.writeFile(built.absPath, built.content, 'utf8');
    if (kind === 'component' && built.wroteEntryStubs.length) {
      const dir = path.dirname(built.absPath);
      const renderer = inferProjectRenderer(
        handoff.runtimeConfig?.entries?.components ?? {},
        String(payload.renderer ?? '')
      );
      const stubs = entryStubFilesForRenderer(entityId, renderer);
      for (const name of built.wroteEntryStubs) {
        const stubPath = path.join(dir, name);
        if (!(await fs.pathExists(stubPath))) {
          await fs.writeFile(stubPath, stubs[name] ?? '', 'utf8');
        }
      }
    }
  }
  return { wroteEntryStubs: built.wroteEntryStubs };
}

export async function writeBuildArtifactsFromPayload(
  handoff: Handoff,
  entityType: 'component' | 'pattern',
  entityId: string,
  payload: Record<string, unknown>,
  dryRun: boolean
): Promise<string[]> {
  const artifacts = payload.buildArtifacts;
  if (!artifacts || typeof artifacts !== 'object') return [];

  const baseDir =
    entityType === 'component'
      ? getComponentDistPath(handoff, entityId)
      : path.join(handoff.workingPath, 'public/api/pattern');

  const written: string[] = [];
  for (const [name, content] of Object.entries(artifacts as Record<string, string>)) {
    if (typeof content !== 'string') continue;
    const abs = path.join(baseDir, name);
    if (!dryRun) {
      await fs.mkdirp(baseDir);
      if (isBinaryArtifactFilename(name)) {
        await fs.writeFile(abs, Buffer.from(content, 'base64'));
      } else {
        await fs.writeFile(abs, content, 'utf8');
      }
    }
    written.push(name);
  }
  return written;
}
