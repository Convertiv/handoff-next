import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import Handoff from '@handoff/root/index.js';
import { getDb } from '../db';
import { figmaFetchJobs, handoffTokensSnapshots } from '../db/schema';
import { getValidFigmaAccessTokenForUser } from './figma-auth';
import { loadHandoffConfigFile } from './handoff-config-load';
import { logEvent } from './event-log';

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

  try {
    const accessToken = await getValidFigmaAccessTokenForUser(job.triggeredByUserId);

    // Load the committed handoff.config.* via the app's runtime-safe loader (cwd-relative
    // discovery), then inject it as a Handoff override. Handoff's own CLI loader looks at
    // the baked HANDOFF_WORKING_PATH, which doesn't exist in the Lambda — so we can't rely
    // on it. The override is merged over whatever Handoff loads, guaranteeing figma_project_id
    // and transformer options are present regardless.
    const loaded = loadHandoffConfigFile();
    const handoff = new Handoff(false, true, loaded?.config ?? undefined);

    // Writes (exported tokens/assets) go to a writable dir. HANDOFF_WORKING_PATH is a baked
    // build-server path that doesn't exist at runtime, so fall back to /tmp.
    if (!fs.existsSync(handoff.workingPath)) {
      handoff.workingPath = '/tmp';
    }

    // Resolve figma project ID. HANDOFF_PROJECT_ID may be the unsubstituted placeholder
    // default ('default') in direct registry deploys — treat that as unset.
    const resolveId = (v: string | undefined | null) => (v?.trim() && v.trim() !== 'default' ? v.trim() : null);
    const projectId =
      resolveId(process.env.HANDOFF_FIGMA_PROJECT_ID) ??
      resolveId(handoff.config?.figma_project_id) ??
      resolveId(loaded?.config?.figma_project_id) ??
      resolveId(process.env.HANDOFF_PROJECT_ID) ??
      null;

    if (!projectId) {
      throw new Error(
        'Could not resolve figma_project_id. Ensure handoff.config.* is committed at the repo root, ' +
        'or set HANDOFF_FIGMA_PROJECT_ID as a Vercel environment variable.'
      );
    }
    if (!handoff.config) {
      throw new Error('Handoff config not initialized.');
    }

    handoff.config.dev_access_token = `Bearer ${accessToken}`;
    handoff.config.figma_project_id = projectId;

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
      const { ingestFigmaFillsFromManifest } = await import('./figma-fills-ingest');
      const { ingested, skipped } = await ingestFigmaFillsFromManifest(
        handoff.getOutputPath(),
        job.triggeredByUserId,
      );
      if (ingested > 0) console.log(`[figma-fetch] Ingested ${ingested} image fill(s).`);
      if (skipped > 0) console.warn(`[figma-fetch] Skipped ${skipped} image fill(s).`);
    } catch (fillErr) {
      console.error('[figma-fetch] Fills ingest failed:', fillErr);
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
  }
}
