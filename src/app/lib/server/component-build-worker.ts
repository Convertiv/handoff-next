/**
 * Standalone worker: `npx tsx src/app/lib/server/component-build-worker.ts <jobId>`
 * Run from handoff-app repo root with DATABASE_URL (Postgres) or local SQLite (no DATABASE_URL).
 */
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildHandoffDeclarationCjs, type DeclarationPreviewEntry } from './component-scaffold';
import { resolveHandoffRepoRoot } from './component-builder';
import { getDb } from '../db';
import { componentBuildJobs, handoffComponents } from '../db/schema';
import { logEvent } from './event-log';

function declPreviewsFromData(data: Record<string, unknown>): Record<string, DeclarationPreviewEntry> | undefined {
  const raw = data.previews;
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, DeclarationPreviewEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title : k;
    const values = (
      o.values && typeof o.values === 'object'
        ? o.values
        : o.args && typeof o.args === 'object'
          ? o.args
          : {}
    ) as Record<string, unknown>;
    out[k] = { title, values };
  }
  return Object.keys(out).length ? out : undefined;
}

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

  console.log(`[component-build-worker] starting jobId=${jobId}`);

  const db = getDb();

  const [job] = await db.select().from(componentBuildJobs).where(eq(componentBuildJobs.id, jobId));
  if (!job) {
    console.error('Job not found', jobId);
    process.exit(1);
  }

  const componentId = job.componentId;
  const [row] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, componentId));
  if (!row) {
    await logEvent({
      category: 'build',
      eventType: 'component_build.run',
      status: 'error',
      route: 'worker:component-build',
      entityType: 'component_build_job',
      entityId: String(jobId),
      error: 'Component row not found',
      metadata: { componentId },
    });
    await db
      .update(componentBuildJobs)
      .set({ status: 'failed', error: 'Component row not found', completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
    process.exit(1);
  }

  await db.update(componentBuildJobs).set({ status: 'building' }).where(eq(componentBuildJobs.id, jobId));

    const repoRoot = resolveHandoffRepoRoot();
    const workingDir = process.env.HANDOFF_WORKING_PATH?.trim() || repoRoot;
    const bundleAbs = path.join(repoRoot, `.handoff-component-builds/${jobId}/${componentId}`);

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
      previews: declPreviewsFromData(data),
    });
    await writeFile(`${componentId}.handoff.cjs`, decl);

    // chdir to the project's working directory so the Handoff constructor
    // picks up the correct handoff.config.js (with cssBuildConfig hooks,
    // Vite aliases, scss entries, etc.) instead of the repo root config.
    process.chdir(workingDir);

    const Handoff = await loadHandoff(repoRoot);
    const handoff = new Handoff(false, true, {
      entries: {
        components: [bundleAbs],
      },
    });

    const workerTimeoutMs = (() => {
      const n = Number(process.env.HANDOFF_COMPONENT_WORKER_TIMEOUT_MS);
      if (Number.isFinite(n) && n >= 15_000) return Math.min(n, 900_000);
      return 180_000;
    })();

    const t0 = Date.now();
    await Promise.race([
      handoff.component(componentId),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error(`Build timeout after ${Math.round(workerTimeoutMs / 1000)}s`)), workerTimeoutMs);
      }),
    ]);
    const ms = Date.now() - t0;
    console.log(`Built component ${componentId} in ${ms}ms`);

    // Built artifacts stay under the linked client project (HANDOFF_WORKING_PATH);
    // app-builder / dev sync mirrors public from there — do not copy into handoff-app.

    await fs.remove(path.join(repoRoot, '.handoff-component-builds', String(jobId))).catch(() => undefined);

    await db
      .update(componentBuildJobs)
      .set({ status: 'complete', error: null, completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
    await logEvent({
      category: 'build',
      eventType: 'component_build.run',
      status: 'success',
      route: 'worker:component-build',
      entityType: 'component_build_job',
      entityId: String(jobId),
      durationMs: job.createdAt ? Date.now() - job.createdAt.getTime() : null,
      metadata: { componentId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    await db
      .update(componentBuildJobs)
      .set({ status: 'failed', error: msg.slice(0, 8000), completedAt: new Date() })
      .where(eq(componentBuildJobs.id, jobId));
    await logEvent({
      category: 'build',
      eventType: 'component_build.run',
      status: 'error',
      route: 'worker:component-build',
      entityType: 'component_build_job',
      entityId: String(jobId),
      durationMs: job.createdAt ? Date.now() - job.createdAt.getTime() : null,
      error: msg,
      metadata: { componentId },
    });
    await fs.remove(path.join(repoRoot, '.handoff-component-builds', String(jobId))).catch(() => undefined);
    process.exit(1);
  }
}

void main();
