import fs from 'fs-extra';
import path from 'path';
import { MAIN_COMPONENT_CSS_FILE, SHARED_COMPONENT_CSS_FILE } from '@handoff/transformers/preview/component/css.js';
import { MAIN_COMPONENT_JS_FILE } from '@handoff/transformers/preview/component/javascript.js';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';

const COMPONENT_JS_RESERVED = new Set([MAIN_COMPONENT_JS_FILE]);
const COMPONENT_CSS_RESERVED = new Set([MAIN_COMPONENT_CSS_FILE, SHARED_COMPONENT_CSS_FILE]);

const WARN_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 10 * 1024 * 1024;

export type CollectedArtifacts = {
  files: Record<string, string>;
  totalBytes: number;
  warnings: string[];
};

function componentApiDir(handoff: Handoff): string {
  return path.join(handoff.workingPath, 'public/api/component');
}

function patternApiDir(handoff: Handoff): string {
  return path.join(handoff.workingPath, 'public/api/pattern');
}

async function collectMatchingFiles(dir: string, prefix: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries.filter((name) => {
    if (name === `${prefix}.json` || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-`)) {
      if (COMPONENT_JS_RESERVED.has(name) || COMPONENT_CSS_RESERVED.has(name)) {
        return name === `${prefix}.js` || name === `${prefix}.css`;
      }
      return true;
    }
    return false;
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
  const dir = componentApiDir(handoff);
  const names = await collectMatchingFiles(dir, componentId);
  if (!names.includes(`${componentId}.json`)) {
    Logger.warn(`Component "${componentId}": missing public/api/component/${componentId}.json — build before push or use --metadata-only.`);
  }
  return readArtifactFiles(dir, names);
}

export async function collectPatternBuildArtifacts(handoff: Handoff, patternId: string): Promise<CollectedArtifacts> {
  const dir = patternApiDir(handoff);
  const names = await collectMatchingFiles(dir, patternId);
  return readArtifactFiles(dir, names);
}

export async function collectSharedComponentAssets(handoff: Handoff): Promise<Record<string, string>> {
  const dir = componentApiDir(handoff);
  const shared = [MAIN_COMPONENT_CSS_FILE, SHARED_COMPONENT_CSS_FILE, MAIN_COMPONENT_JS_FILE];
  const out: Record<string, string> = {};
  for (const name of shared) {
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
