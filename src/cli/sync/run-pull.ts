import type { SyncChangeset } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { applySyncChangeset } from './apply-pull.js';
import { readSyncState, writeSyncState, type HandoffSyncStateFile } from './sync-state.js';
import { getSyncBearerToken, resolveSyncRemoteUrl } from './sync-remote-env.js';

export type RunPullOptions = {
  /** Fetch remote changes and print what would happen without writing files or updating sync state. */
  dryRun?: boolean;
};

/**
 * Pull remote sync events and write local `pages/` and `*.handoff.json` declarations.
 */
export async function runPull(handoff: Handoff, opts?: RunPullOptions): Promise<void> {
  const dryRun = Boolean(opts?.dryRun);
  const workPath = handoff.workingPath;
  const baseUrl = await resolveSyncRemoteUrl(workPath);
  const bearer = await getSyncBearerToken(workPath);
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
    Logger.warn(`Sync remote URL changed (${state.remoteUrl} -> ${baseUrl}); resetting sync cursor.`);
    state.remoteUrl = baseUrl;
    state.lastSyncVersion = 0;
  }

  const since = state.lastSyncVersion;
  const url = `${baseUrl}/api/sync/changes?since=${encodeURIComponent(String(since))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync pull failed (${res.status}): ${text || res.statusText}`);
  }

  const changeset = (await res.json()) as SyncChangeset;
  if (!changeset || typeof changeset.version !== 'number' || !Array.isArray(changeset.changes)) {
    throw new Error('Invalid sync changeset response');
  }

  if (dryRun) {
    Logger.info('Dry run: no files or .handoff/sync-state.json will be modified.');
  }

  const summary = await applySyncChangeset(handoff, changeset, state as HandoffSyncStateFile, { dryRun });
  if (!dryRun) {
    await writeSyncState(workPath, state);
  }

  const label = dryRun ? 'Dry run complete' : 'Pull complete';
  const counts = dryRun
    ? `${summary.written.length} would write, ${summary.deleted.length} would delete, ${summary.conflicts.length} would conflict, ${summary.skipped.length} skipped`
    : `${summary.written.length} written, ${summary.deleted.length} deleted, ${summary.conflicts.length} conflicts, ${summary.skipped.length} skipped`;
  Logger.success(`${label}: ${counts} (remote version ${changeset.version}).`);
  if (summary.conflicts.length) {
    Logger.warn(
      dryRun
        ? `Conflicts would be written under ${workPath}/.handoff/conflicts/ — resolve locally then pull without --dry-run.`
        : `Resolve conflicts under ${workPath}/.handoff/conflicts/ then pull again.`
    );
  }
  if (summary.written.length) {
    const prefix = dryRun ? 'Would update' : 'Updated files';
    Logger.info(`${prefix}:\n${summary.written.map((s) => `  - ${s}`).join('\n')}`);
  }
  if (dryRun && summary.deleted.length) {
    Logger.info(`Would delete:\n${summary.deleted.map((s) => `  - ${s}`).join('\n')}`);
  }
}
