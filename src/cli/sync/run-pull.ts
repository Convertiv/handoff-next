import type { SyncChangeset } from '../../types/handoff-sync';
import type Handoff from '../../index';
import { Logger } from '../../utils/logger';
import { applySyncChangeset } from './apply-pull';
import { readSyncState, writeSyncState, type HandoffSyncStateFile } from './sync-state';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

/**
 * Pull remote sync events and write local `pages/` and `*.handoff.json` declarations.
 */
export async function runPull(handoff: Handoff): Promise<void> {
  const baseUrl = requireEnv('HANDOFF_SYNC_URL').replace(/\/$/, '');
  const secret = requireEnv('HANDOFF_SYNC_SECRET');

  const workPath = handoff.workingPath;
  let state = await readSyncState(workPath);
  if (!state) {
    state = {
      remoteUrl: baseUrl,
      lastSyncVersion: 0,
      lastSyncAt: '',
      fingerprints: {},
    };
  }
  if (state.remoteUrl !== baseUrl) {
    Logger.warn(`HANDOFF_SYNC_URL changed (${state.remoteUrl} -> ${baseUrl}); resetting sync cursor.`);
    state.remoteUrl = baseUrl;
    state.lastSyncVersion = 0;
  }

  const since = state.lastSyncVersion;
  const url = `${baseUrl}/api/sync/changes?since=${encodeURIComponent(String(since))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync pull failed (${res.status}): ${text || res.statusText}`);
  }

  const changeset = (await res.json()) as SyncChangeset;
  if (!changeset || typeof changeset.version !== 'number' || !Array.isArray(changeset.changes)) {
    throw new Error('Invalid sync changeset response');
  }

  const summary = await applySyncChangeset(handoff, changeset, state as HandoffSyncStateFile);
  await writeSyncState(workPath, state);

  Logger.success(
    `Pull complete: ${summary.written.length} written, ${summary.deleted.length} deleted, ${summary.conflicts.length} conflicts, ${summary.skipped.length} skipped.`
  );
  if (summary.conflicts.length) {
    Logger.warn(`Resolve conflicts under ${workPath}/.handoff/conflicts/ then pull again.`);
  }
  if (summary.written.length) {
    Logger.info(`Updated files:\n${summary.written.map((s) => `  - ${s}`).join('\n')}`);
  }
}
