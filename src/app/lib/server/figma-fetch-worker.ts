import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import Handoff from '../../../index';
import { getDb } from '../db';
import { figmaFetchJobs, handoffTokensSnapshots } from '../db/schema';
import { getValidFigmaAccessTokenForUser } from './figma-auth';

async function main() {
  const jobId = Number(process.argv[2]);
  if (!Number.isFinite(jobId)) {
    console.error('Usage: tsx figma-fetch-worker.ts <jobId>');
    process.exit(1);
  }

  process.env.HANDOFF_MODE = process.env.HANDOFF_MODE || 'dynamic';
  const db = getDb();
  if (!db) {
    console.error('No database (HANDOFF_MODE=dynamic and DATABASE_URL required)');
    process.exit(1);
  }

  const [job] = await db.select().from(figmaFetchJobs).where(eq(figmaFetchJobs.id, jobId));
  if (!job) {
    console.error('Job not found', jobId);
    process.exit(1);
  }
  if (!job.triggeredByUserId) {
    await db
      .update(figmaFetchJobs)
      .set({ status: 'failed', error: 'Missing triggering user', completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));
    process.exit(1);
  }

  await db.update(figmaFetchJobs).set({ status: 'running' }).where(eq(figmaFetchJobs.id, jobId));

  try {
    const accessToken = await getValidFigmaAccessTokenForUser(job.triggeredByUserId);
    const handoff = new Handoff(false, true);
    const projectId = process.env.HANDOFF_FIGMA_PROJECT_ID ?? handoff.config?.figma_project_id ?? null;

    if (!projectId) {
      throw new Error('Missing HANDOFF_FIGMA_PROJECT_ID (or figma_project_id in handoff config).');
    }

    if (!handoff.config) {
      throw new Error('Handoff config not initialized.');
    }
    handoff.config.dev_access_token = `Bearer ${accessToken}`;
    handoff.config.figma_project_id = projectId;

    await Promise.race([
      handoff.fetch(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Figma fetch timeout after 120s')), 120_000);
      }),
    ]);

    const tokensPath = handoff.getTokensFilePath();
    const payload = (await fs.readJSON(tokensPath)) as unknown;
    await db.insert(handoffTokensSnapshots).values({ payload: payload as Record<string, unknown> });

    await db
      .update(figmaFetchJobs)
      .set({ status: 'complete', error: null, completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    await db
      .update(figmaFetchJobs)
      .set({ status: 'failed', error: msg.slice(0, 8000), completedAt: new Date() })
      .where(eq(figmaFetchJobs.id, jobId));
    process.exit(1);
  }
}

void main();
