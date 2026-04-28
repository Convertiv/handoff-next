import type { SyncStatusResponse } from '../../types/handoff-sync';
import type Handoff from '../../index';
import { Logger } from '../../utils/logger';
import { readSyncState } from './sync-state';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

export async function runSyncStatus(handoff: Handoff): Promise<void> {
  const baseUrl = requireEnv('HANDOFF_SYNC_URL').replace(/\/$/, '');
  const secret = requireEnv('HANDOFF_SYNC_SECRET');

  const url = `${baseUrl}/api/sync/status`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync status failed (${res.status}): ${text || res.statusText}`);
  }

  const remote = (await res.json()) as SyncStatusResponse;
  const local = await readSyncState(handoff.workingPath);

  Logger.log(`Remote: ${baseUrl}`);
  Logger.log(`  latestVersion: ${remote.latestVersion}`);
  Logger.log(`  counts: ${JSON.stringify(remote.counts)}`);
  Logger.log(`Local sync state (${handoff.workingPath}/.handoff/sync-state.json):`);
  if (!local) {
    Logger.log('  (not initialized — run handoff pull first)');
    return;
  }
  Logger.log(`  remoteUrl: ${local.remoteUrl}`);
  Logger.log(`  lastSyncVersion: ${local.lastSyncVersion}`);
  Logger.log(`  lastSyncAt: ${local.lastSyncAt || '(never)'}`);
  Logger.log(`  fingerprinted entities: ${Object.keys(local.fingerprints).length}`);
}
