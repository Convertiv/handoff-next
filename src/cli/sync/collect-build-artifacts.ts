import fs from 'fs-extra';
import path from 'path';
import { getComponentDistPath } from '@handoff/transformers/preview/component/api.js';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';

const WARN_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 10 * 1024 * 1024;

export type CollectedArtifacts = {
  files: Record<string, string>;
  totalBytes: number;
  warnings: string[];
};

function patternApiDir(handoff: Handoff): string {
  return path.join(handoff.workingPath, 'public/api/pattern');
}

/**
 * Files that ship as artifacts despite NOT being prefixed with the component
 * id. Add a name here when a new generator writes to `components/<id>/dist/`
 * using a generic filename — otherwise the file lives on disk forever but
 * never reaches the registry, and the served URL 404s.
 *
 * Historic regression: `screenshot.png` (introduced in #46) was generated
 * but never pushed, so the image URL stamped onto `data.image` resolved to
 * 404 on the registry side. This list closes that gap.
 */
const COMMON_DIST_FILENAMES = new Set(['screenshot.png']);

async function collectMatchingFiles(dir: string, prefix: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries.filter((name) => {
    if (name.startsWith('.')) return false; // skip Vite temp dirs
    if (COMMON_DIST_FILENAMES.has(name)) return true;
    return name === `${prefix}.json` || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-`);
  });
}

async function readArtifactFiles(dir: string, names: string[]): Promise<CollectedArtifacts> {
  const files: Record<string, string> = {};
  let totalBytes = 0;
  const warnings: string[] = [];

  for (const name of names) {
    const abs = path.join(dir, name);
    if (!(await fs.pathExists(abs))) continue;
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;

    const ext = path.extname(name).toLowerCase();
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp') {
      const buf = await fs.readFile(abs);
      files[name] = buf.toString('base64');
      totalBytes += buf.length;
    } else {
      const text = await fs.readFile(abs, 'utf8');
      files[name] = text;
      totalBytes += Buffer.byteLength(text, 'utf8');
    }
  }

  if (totalBytes > WARN_BYTES) {
    warnings.push(`Artifact bundle is ${Math.round(totalBytes / 1024)}KB (>${Math.round(WARN_BYTES / 1024)}KB warning threshold).`);
  }
  if (totalBytes > MAX_BYTES) {
    throw new Error(`Artifact bundle exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit (${Math.round(totalBytes / 1024 / 1024)}MB).`);
  }

  return { files, totalBytes, warnings };
}

export async function collectComponentBuildArtifacts(handoff: Handoff, componentId: string): Promise<CollectedArtifacts> {
  const dir = getComponentDistPath(handoff, componentId);
  const names = await collectMatchingFiles(dir, componentId);
  if (!names.includes(`${componentId}.json`)) {
    Logger.warn(`Component "${componentId}": missing components/${componentId}/dist/${componentId}.json — build before push or use --metadata-only.`);
  }
  return readArtifactFiles(dir, names);
}

export async function collectPatternBuildArtifacts(handoff: Handoff, patternId: string): Promise<CollectedArtifacts> {
  const dir = patternApiDir(handoff);
  const names = await collectMatchingFiles(dir, patternId);
  return readArtifactFiles(dir, names);
}

export async function collectSharedComponentAssets(handoff: Handoff): Promise<Record<string, string>> {
  const dir = path.join(handoff.workingPath, 'public/api/component');
  const sharedFiles = ['main.css', 'shared.css', 'main.js'];
  const out: Record<string, string> = {};
  for (const name of sharedFiles) {
    const abs = path.join(dir, name);
    if (await fs.pathExists(abs)) {
      out[name] = await fs.readFile(abs, 'utf8');
    }
  }
  return out;
}

export function isBinaryArtifactFilename(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp';
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.hbs', '.tsx', '.jsx', '.js', '.scss', '.css', '.md', '.json']);

/**
 * Collect handoff-layer source files for a component (everything in components/[id]/ except dist/).
 * Returns a record keyed by relative file path.
 * For monorepo projects (e.g. thin wrapper components), only the handoff-layer files are collected —
 * external library dependencies are not included and must come from git.
 */
export async function collectComponentSourceFiles(handoff: Handoff, componentId: string): Promise<Record<string, string>> {
  const componentDir = path.join(handoff.workingPath, 'components', componentId);
  if (!(await fs.pathExists(componentDir))) return {};

  const out: Record<string, string> = {};
  const entries = await fs.readdir(componentDir);

  for (const name of entries) {
    if (name === 'dist' || name.startsWith('.')) continue;
    const abs = path.join(componentDir, name);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    try {
      out[name] = await fs.readFile(abs, 'utf8');
    } catch {
      // skip unreadable files
    }
  }

  return out;
}
