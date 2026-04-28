/**
 * Standalone worker: `npx tsx src/app/lib/server/component-build-worker.ts <jobId>`
 * Run from handoff-app repo root with DATABASE_URL + HANDOFF_MODE=dynamic.
 */
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildHandoffDeclarationCjs } from './component-scaffold';
import { resolveHandoffRepoRoot } from './component-builder';
import { getDb } from '../db';
import { componentBuildJobs, handoffComponents } from '../db/schema';

async function loadHandoff(repoRoot: string) {
  const srcTs = path.join(repoRoot, 'src/index.ts');
  const distJs = path.join(repoRoot, 'dist/index.js');
  const entry = (await fs.pathExists(srcTs)) ? srcTs : distJs;
  const mod = await import(pathToFileURL(entry).href);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mod.default as any;
}

async function main() {
  const jobId = Number(process.argv[2]);
  if (!Number.isFinite(jobId)) {
    console.error('Usage: tsx component-build-worker.ts <jobId>');
    process.exit(1);
  }

  process.env.HANDOFF_MODE = process.env.HANDOFF_MODE || 'dynamic';
  const db = getDb();
  if (!db) {
    console.error('No database (HANDOFF_MODE=dynamic and DATABASE_URL required)');
    process.exit(1);
  }

  const [job] = await db.select().from(componentBuildJobs).where(eq(componentBuildJobs.id, jobId));
  if (!job) {
    console.error('Job not found', jobId);
    process.exit(1);
  }

  const componentId = job.componentId;
  const [row] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, componentId));
  if (!row) {
    await db
      .update(componentBuildJobs)
      .set({ status: 'failed', error: 'Component row not found', completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
    process.exit(1);
  }

  await db.update(componentBuildJobs).set({ status: 'building' }).where(eq(componentBuildJobs.id, jobId));

  const repoRoot = resolveHandoffRepoRoot();
  const relBundle = `.handoff-component-builds/${jobId}/${componentId}`;
  const bundleAbs = path.join(repoRoot, relBundle);

  try {
    await fs.remove(bundleAbs);
    await fs.mkdirp(bundleAbs);

    const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
    const entrySources = (data.entrySources && typeof data.entrySources === 'object' ? data.entrySources : {}) as Record<string, string>;
    const renderer = String(data.renderer ?? 'handlebars');

    const writeFile = (name: string, content: string) => fs.writeFile(path.join(bundleAbs, name), content, 'utf8');

    if (renderer === 'react') {
      await writeFile(`${componentId}.tsx`, entrySources.component || `import React from 'react';\nexport default () => <div />;\n`);
    } else if (renderer === 'csf') {
      await writeFile(`${componentId}.stories.tsx`, entrySources.story || `import React from 'react';\nexport default { title: 'Demo' };\nexport const Default = () => <div />;\n`);
    } else {
      await writeFile(
        `${componentId}.hbs`,
        entrySources.template ||
          `<head>{{{style}}}{{{script}}}</head><body class="theme preview-body"></body>\n`
      );
    }

    await writeFile(`${componentId}.scss`, entrySources.scss || '/* */\n');
    await writeFile(`${componentId}.client.js`, entrySources.js || '//\n');

    const decl = buildHandoffDeclarationCjs({
      id: componentId,
      title: row.title || componentId,
      description: row.description ?? '',
      group: row.group ?? '',
      type: row.type ?? 'element',
      renderer,
    });
    await writeFile(`${componentId}.handoff.cjs`, decl);

    const Handoff = await loadHandoff(repoRoot);
    const handoff = new Handoff(false, true, {
      entries: {
        components: [relBundle],
      },
    });

    const t0 = Date.now();
    await Promise.race([
      handoff.component(componentId),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error('Build timeout after 30s')), 30_000);
      }),
    ]);
    const ms = Date.now() - t0;
    console.log(`Built component ${componentId} in ${ms}ms`);

    const builtDir = path.join(repoRoot, 'public/api/component');
    const destDir = path.join(repoRoot, 'src/app/public/api/component');
    await fs.mkdirp(destDir);

    if (await fs.pathExists(builtDir)) {
      const names = await fs.readdir(builtDir);
      for (const name of names) {
        if (name === componentId || name.startsWith(`${componentId}.`)) {
          await fs.copy(path.join(builtDir, name), path.join(destDir, name), { overwrite: true });
        }
      }
    }

    await fs.remove(path.join(repoRoot, '.handoff-component-builds', String(jobId))).catch(() => undefined);

    await db
      .update(componentBuildJobs)
      .set({ status: 'complete', error: null, completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    await db
      .update(componentBuildJobs)
      .set({ status: 'failed', error: msg.slice(0, 8000), completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
    await fs.remove(path.join(repoRoot, '.handoff-component-builds', String(jobId))).catch(() => undefined);
    process.exit(1);
  }
}

void main();
