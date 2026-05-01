import { spawnSync } from 'child_process';
import { inArray } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { getDb } from '../db';
import { handoffComponents } from '../db/schema';
import { getComponentExportProjectRoot } from './handoff-config-load';

export type ExportComponentsOptions = {
  /** Absolute path to parent directory containing one folder per component id */
  outputDir: string;
  componentIds?: string[];
  autoCommit?: boolean;
};

export type ExportComponentsResult = {
  exported: string[];
  commitSha?: string;
  gitMessage?: string;
  gitWarning?: string;
};

function diskManifestFromData(data: Record<string, unknown>, id: string): Record<string, unknown> {
  const renderer = (data.renderer as string) || 'handlebars';
  const entries: Record<string, string> = {};
  if (renderer === 'handlebars') {
    entries.template = './template.hbs';
    entries.scss = './style.scss';
    entries.js = './script.js';
  } else if (renderer === 'react') {
    entries.component = `./${id}.tsx`;
    entries.scss = './style.scss';
    entries.js = './script.js';
  } else if (renderer === 'csf') {
    entries.story = `./${id}.stories.tsx`;
    entries.scss = './style.scss';
    entries.js = './script.js';
  }

  const omit = new Set(['entrySources', 'path']);
  const manifest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (omit.has(k)) continue;
    manifest[k] = v;
  }
  manifest.id = id;
  manifest.entries = entries;
  return manifest;
}

function writeCjsManifest(outDir: string, manifest: Record<string, unknown>): void {
  const body = JSON.stringify(manifest, null, 2);
  const file = `/** @type {import('handoff-app').Component} */\nmodule.exports = ${body};\n`;
  const manifestName = `${String(manifest.id)}.js`;
  fs.writeFileSync(path.join(outDir, manifestName), file, 'utf8');
}

/**
 * Export DB components to legacy filesystem layout under `outputDir/<id>/`.
 */
export async function exportComponentsToFilesystem(opts: ExportComponentsOptions): Promise<ExportComponentsResult> {
  const db = getDb();

  const ids = opts.componentIds;
  const rows =
    ids && ids.length > 0
      ? await db.select().from(handoffComponents).where(inArray(handoffComponents.id, ids))
      : await db.select().from(handoffComponents);

  const exported: string[] = [];
  await fs.ensureDir(opts.outputDir);

  for (const row of rows) {
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
    const id = row.id;
    const entrySources =
      data.entrySources && typeof data.entrySources === 'object' && !Array.isArray(data.entrySources)
        ? (data.entrySources as Record<string, string>)
        : {};

    const compDir = path.join(opts.outputDir, id);
    await fs.ensureDir(compDir);

    const renderer = (data.renderer as string) || 'handlebars';
    if (renderer === 'handlebars') {
      if (entrySources.template != null) await fs.writeFile(path.join(compDir, 'template.hbs'), entrySources.template, 'utf8');
      if (entrySources.scss != null) await fs.writeFile(path.join(compDir, 'style.scss'), entrySources.scss, 'utf8');
      if (entrySources.js != null) await fs.writeFile(path.join(compDir, 'script.js'), entrySources.js, 'utf8');
    } else if (renderer === 'react') {
      if (entrySources.component != null) await fs.writeFile(path.join(compDir, `${id}.tsx`), entrySources.component, 'utf8');
      if (entrySources.scss != null) await fs.writeFile(path.join(compDir, 'style.scss'), entrySources.scss, 'utf8');
      if (entrySources.js != null) await fs.writeFile(path.join(compDir, 'script.js'), entrySources.js, 'utf8');
    } else if (renderer === 'csf') {
      if (entrySources.story != null) await fs.writeFile(path.join(compDir, `${id}.stories.tsx`), entrySources.story, 'utf8');
      if (entrySources.scss != null) await fs.writeFile(path.join(compDir, 'style.scss'), entrySources.scss, 'utf8');
      if (entrySources.js != null) await fs.writeFile(path.join(compDir, 'script.js'), entrySources.js, 'utf8');
    }

    const mergedData = { ...data, id, title: row.title, description: row.description ?? '', group: row.group ?? '', image: row.image ?? '', type: row.type ?? '' };
    const manifest = diskManifestFromData(mergedData, id);
    writeCjsManifest(compDir, manifest);
    exported.push(id);
  }

  let commitSha: string | undefined;
  let gitMessage: string | undefined;
  let gitWarning: string | undefined;

  if (opts.autoCommit !== false && exported.length > 0) {
    const cwd = getComponentExportProjectRoot();
    const check = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
    if (check.status !== 0 || check.stdout.trim() !== 'true') {
      gitWarning = 'Not a git repository; skipped auto-commit.';
    } else {
      const relOut = path.relative(cwd, opts.outputDir) || path.basename(opts.outputDir);
      const add = spawnSync('git', ['add', '--', relOut], { cwd, encoding: 'utf8' });
      if (add.status !== 0) {
        gitWarning = `git add failed: ${add.stderr || add.stdout}`;
      } else {
        const msg =
          exported.length === 1
            ? `chore(components): export ${exported[0]} from Handoff DB`
            : `chore(components): export ${exported.length} components from Handoff DB`;
        const commit = spawnSync('git', ['commit', '-m', msg, '--', relOut], { cwd, encoding: 'utf8' });
        gitMessage = msg;
        if (commit.status !== 0) {
          if (/nothing to commit|no changes added/i.test(commit.stderr || commit.stdout || '')) {
            gitWarning = 'Nothing to commit (working tree clean for exported paths).';
          } else {
            gitWarning = `git commit failed: ${commit.stderr || commit.stdout}`;
          }
        } else {
          const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
          commitSha = sha.stdout?.trim();
        }
      }
    }
  }

  return { exported, commitSha, gitMessage, gitWarning };
}
