import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { getDb } from '../db';
import { componentBuildJobs } from '../db/schema';
import { resolveHandoffRepoRoot } from './handoff-config-load';

export { resolveHandoffRepoRoot };

export async function insertBuildJob(componentId: string): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Database unavailable');
  const [row] = await db.insert(componentBuildJobs).values({ componentId, status: 'queued' }).returning({ id: componentBuildJobs.id });
  return row.id;
}

export async function getBuildJob(jobId: number) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(componentBuildJobs).where(eq(componentBuildJobs.id, jobId));
  return row ?? null;
}

const WORKER_ENV_ALLOWLIST = [
  'DATABASE_URL',
  'HANDOFF_MODE',
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'HANDOFF_APP_BASE_PATH',
  'HANDOFF_COMPONENT_BUILD_REPO_ROOT',
  'TZ',
  'LANG',
  'LC_ALL',
  // Windows: Node / native tooling often need these
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
] as const;

function buildWorkerEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  if (!out.NODE_ENV) {
    out.NODE_ENV = process.env.NODE_ENV ?? 'development';
  }
  return out;
}

/**
 * Runs the build worker in a separate Node process so a bad template cannot take down the Next server.
 * Uses `node --require` to load a polyfill (for esbuild's __name helper) before tsx registers,
 * avoiding conflicts between tsx's module transforms and Vite/sass internals.
 */
export function spawnComponentBuildWorker(jobId: number): void {
  const repoRoot = resolveHandoffRepoRoot();
  const worker = path.join(repoRoot, 'src/app/lib/server/component-build-worker.ts');
  const preload = path.join(repoRoot, 'src/app/lib/server/component-build-preload.cjs');
  const child = spawn('node', ['--require', preload, '--import', 'tsx', worker, String(jobId)], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildWorkerEnv(),
  });
  child.stderr?.on('data', (chunk) => {
    console.error(`[component-build ${jobId}]`, chunk.toString());
  });
  child.stdout?.on('data', (chunk) => {
    console.log(`[component-build ${jobId}]`, chunk.toString());
  });
  child.on('error', (err) => {
    console.error(`[component-build ${jobId}] spawn error`, err);
  });
}
