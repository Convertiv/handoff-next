import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import Handoff from '@handoff/root/index.js';
import { getDb } from '../db';
import { figmaFetchJobs, handoffTokensSnapshots } from '../db/schema';
import { getValidFigmaAccessTokenForUser } from './figma-auth';
import { loadHandoffConfigFile } from './handoff-config-load';
import { logEvent } from './event-log';

/**
 * Read figma_project_id from the registry config blob in the DB (written by the
 * workspace push). Returns null when no registry config / no id / DB unavailable.
 */
async function getRegistryFigmaProjectId(): Promise<string | null> {
  try {
    const { getRegistryConfig } = await import('../db/registry-queries');
    const cfg = await getRegistryConfig();
    const id = cfg?.figma_project_id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Reclaim Lambda /tmp space leaked by earlier fetches on this warm instance. Best-effort; never throws.
 *
 * Cleans two categories:
 *   1. Legacy shared scratch dirs from when workingPath was '/tmp' directly.
 *   2. Abandoned per-job dirs under /tmp/handoff-fetch/ from jobs that crashed before their
 *      finally block ran. Called before the current job's scratchDir is created, so all
 *      entries present are from previous runs on this warm Lambda instance and are safe to
 *      delete. On Vercel, concurrent invocations each get their own /tmp, so there is no
 *      risk of deleting a concurrent job's active dir.
 */
async function reclaimTmpSpace(currentJobId: number): Promise<void> {
  const stale = [
    path.join('/tmp', '.handoff'),
    path.join('/tmp', 'exported'),
    path.join('/tmp', 'design-system'),
  ];
  await Promise.all(stale.map((p) => fs.remove(p).catch(() => {})));

  // Clean abandoned per-job scratch dirs from previous warm-instance runs.
  const fetchBase = path.join('/tmp', 'handoff-fetch');
  try {
    const entries = await fs.readdir(fetchBase);
    await Promise.all(
      entries
        .filter((e) => e !== String(currentJobId))
        .map((e) => fs.remove(path.join(fetchBase, e)).catch(() => {}))
    );
  } catch {
    // fetchBase doesn't exist yet — nothing to clean
  }
}

/**
 * Run a figma fetch job in-process (no child process required).
 * Designed to be called from `after()` in the API route so it runs
 * after the HTTP response is sent without blocking the caller.
 */
export async function runFigmaFetchJob(jobId: number): Promise<void> {
  const db = getDb();

  const [job] = await db.select().from(figmaFetchJobs).where(eq(figmaFetchJobs.id, jobId));
  if (!job) {
    console.error('[figma-fetch] Job not found', jobId);
    return;
  }

  if (!job.triggeredByUserId) {
    await logEvent({
      category: 'figma',
      eventType: 'figma_fetch.run',
      status: 'error',
      route: 'inline:figma-fetch',
      entityType: 'figma_fetch_job',
      entityId: String(jobId),
      error: 'Missing triggering user',
    });
    await db
      .update(figmaFetchJobs)
      .set({ status: 'failed', error: 'Missing triggering user', completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));
    return;
  }

  await db.update(figmaFetchJobs).set({ status: 'running' }).where(eq(figmaFetchJobs.id, jobId));

  // Per-job scratch dir under /tmp. Lambda /tmp is small (~512MB) and PERSISTS across warm
  // invocations, so a shared workingPath accumulates and eventually throws ENOSPC. Isolating
  // each job (and cleaning it in finally) bounds usage to one fetch and avoids same-projectId
  // collisions between concurrent jobs.
  let scratchDir: string | null = null;

  try {
    const accessToken = await getValidFigmaAccessTokenForUser(job.triggeredByUserId);

    // Reclaim space leaked by earlier runs on this warm Lambda instance.
    await reclaimTmpSpace(jobId);

    // Load the committed handoff.config.* via the app's runtime-safe loader (cwd-relative
    // discovery), then inject it as a Handoff override. Handoff's own CLI loader looks at
    // the baked HANDOFF_WORKING_PATH, which doesn't exist in the Lambda — so we can't rely
    // on it. The override is merged over whatever Handoff loads, guaranteeing figma_project_id
    // and transformer options are present regardless.
    const loaded = loadHandoffConfigFile();
    const handoff = new Handoff(false, true, loaded?.config ?? undefined);

    // Always use a per-job scratch dir. The registry fetch runner runs in a serverless Lambda
    // where HANDOFF_WORKING_PATH is baked to the build-server path (doesn't exist at runtime)
    // and process.cwd() may be /tmp or /var/task — both wrong. There is no registry context
    // where the baked working path is useful for writes, so skip the existsSync check entirely.
    scratchDir = path.join('/tmp', 'handoff-fetch', String(jobId));
    await fs.emptyDir(scratchDir);
    handoff.workingPath = scratchDir;

    // Resolve the Figma file id. The registry is DB-backed: the workspace push writes
    // figma_project_id into the registry config (handoff_registry_config.data), so that's
    // the canonical source for a registry deploy. Order: explicit env override → registry
    // DB → loaded config (dev/materialized) → baked HANDOFF_PROJECT_ID. 'default' is the
    // unsubstituted placeholder in direct deploys, so treat it as unset.
    const resolveId = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== 'default' ? v.trim() : null);
    const registryFigmaId = await getRegistryFigmaProjectId();
    const projectId =
      resolveId(process.env.HANDOFF_FIGMA_PROJECT_ID) ??
      resolveId(registryFigmaId) ??
      resolveId(handoff.config?.figma_project_id) ??
      resolveId(loaded?.config?.figma_project_id) ??
      resolveId(process.env.HANDOFF_PROJECT_ID) ??
      null;

    if (!projectId) {
      throw new Error(
        'Could not resolve the Figma file id. Push the workspace config to the registry ' +
        '(it carries figma_project_id), or set HANDOFF_FIGMA_PROJECT_ID as an environment variable.'
      );
    }
    if (!handoff.config) {
      throw new Error('Handoff config not initialized.');
    }

    handoff.config.dev_access_token = `Bearer ${accessToken}`;
    handoff.config.figma_project_id = projectId;
    // Skip disk-based fill downloads — 1000+ fills at ~400KB each would exceed Lambda /tmp.
    // We stream them directly to DB after the fetch (see below).
    handoff.config.skip_image_fills = true;

    // Pre-flight: validate token and file access before starting the full fetch.
    // handoff-core throws without the response body, so we surface the actual Figma error here.
    const meRes = await fetch('https://api.figma.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text().catch(() => '');
      throw new Error(`Figma token rejected (${meRes.status}): ${body}. Reconnect Figma on the System page.`);
    }
    const fileRes = await fetch(`https://api.figma.com/v1/files/${projectId}?depth=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      const body = await fileRes.text().catch(() => '');
      throw new Error(`Figma file access denied (${fileRes.status}) for file "${projectId}": ${body}`);
    }

    await Promise.race([
      handoff.fetch(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Figma fetch timeout after 240s')), 240_000);
      }),
    ]);

    const tokensPath = handoff.getTokensFilePath();
    const payload = (await fs.readJSON(tokensPath)) as unknown;
    await db.insert(handoffTokensSnapshots).values({ payload: payload as Record<string, unknown> });

    try {
      const { streamFigmaFillsToDb } = await import('./figma-fills-ingest');
      const { ingested, skipped } = await streamFigmaFillsToDb(
        projectId,
        `Bearer ${accessToken}`,
        job.triggeredByUserId,
      );
      if (ingested > 0) console.log(`[figma-fetch] Streamed ${ingested} image fill(s) to DB.`);
      if (skipped > 0) console.warn(`[figma-fetch] Skipped ${skipped} image fill(s).`);
    } catch (fillErr) {
      console.error('[figma-fetch] Fills stream failed:', fillErr);
    }

    try {
      const { regenerateAllReferenceMaterialsPersisted } = await import('./reference-material-persist');
      await regenerateAllReferenceMaterialsPersisted({
        actorUserId: job.triggeredByUserId ?? undefined,
        skipLlm: false,
      });
    } catch (refErr) {
      console.error('[figma-fetch] Reference materials regenerate failed:', refErr);
    }

    await db
      .update(figmaFetchJobs)
      .set({ status: 'complete', error: null, completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));

    await logEvent({
      category: 'figma',
      eventType: 'figma_fetch.run',
      status: 'success',
      actorUserId: job.triggeredByUserId,
      route: 'inline:figma-fetch',
      entityType: 'figma_fetch_job',
      entityId: String(jobId),
      durationMs: job.createdAt ? Date.now() - job.createdAt.getTime() : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[figma-fetch]', msg);
    await db
      .update(figmaFetchJobs)
      .set({ status: 'failed', error: msg.slice(0, 8000), completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));
    await logEvent({
      category: 'figma',
      eventType: 'figma_fetch.run',
      status: 'error',
      actorUserId: job.triggeredByUserId,
      route: 'inline:figma-fetch',
      entityType: 'figma_fetch_job',
      entityId: String(jobId),
      durationMs: job.createdAt ? Date.now() - job.createdAt.getTime() : null,
      error: msg,
    });
  } finally {
    // Always reclaim this job's scratch space, even on failure/timeout.
    if (scratchDir) {
      await fs.remove(scratchDir).catch(() => {});
    }
  }
}
