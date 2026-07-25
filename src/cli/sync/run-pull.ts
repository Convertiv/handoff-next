import type { SyncChangeset } from '@handoff/types/handoff-sync';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { applySyncChangeset, type PullSummary } from './apply-pull.js';
import { readSyncState, writeSyncState, type HandoffSyncStateFile } from './sync-state.js';
import { getSyncBearerToken, resolveSyncRemoteUrl } from './sync-remote-env.js';

/** Defensive cap: the server pages the feed, so a full drain should never need this many pages. */
const MAX_PULL_PAGES = 10_000;

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

  if (dryRun) {
    Logger.info('Dry run: no files or .handoff/sync-state.json will be modified.');
  }

  // The change feed is server-paginated: one response carries at most one bounded page
  // (`hasMore`/`nextCursor`). Drain it fully within this single invocation by pulling from
  // `nextCursor` until `hasMore` is false, so behavior matches the old unbounded pull — no
  // events are skipped. Each page's applied changes advance the persisted cursor, so a crash
  // mid-drain resumes from the last completed page rather than replaying from the start.
  let cursor = state.lastSyncVersion;
  let remoteVersion = cursor;
  const summary: PullSummary = { written: [], conflicts: [], deleted: [], skipped: [] };

  for (let page = 0; ; page += 1) {
    if (page >= MAX_PULL_PAGES) {
      Logger.warn(`Sync pull stopped after ${MAX_PULL_PAGES} pages; run pull again to continue draining.`);
      break;
    }

    const url = `${baseUrl}/api/sync/changes?since=${encodeURIComponent(String(cursor))}`;
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
    remoteVersion = changeset.version;

    const pageSummary = await applySyncChangeset(handoff, changeset, state as HandoffSyncStateFile, { dryRun });
    summary.written.push(...pageSummary.written);
    summary.deleted.push(...pageSummary.deleted);
    summary.conflicts.push(...pageSummary.conflicts);
    summary.skipped.push(...pageSummary.skipped);

    if (!dryRun) {
      await writeSyncState(workPath, state);
    }

    // `nextCursor` is the highest id delivered in this page; fall back to `version` for a
    // server that predates the paginated fields (single-page, unbounded response).
    const advanced = changeset.nextCursor ?? changeset.version;
    // Stop when the feed is drained, or defensively if the cursor can't move forward
    // (prevents an infinite loop on a malformed/duplicate response).
    if (!changeset.hasMore || advanced <= cursor) break;
    cursor = advanced;
  }

  const label = dryRun ? 'Dry run complete' : 'Pull complete';
  const counts = dryRun
    ? `${summary.written.length} would write, ${summary.deleted.length} would delete, ${summary.conflicts.length} would conflict, ${summary.skipped.length} skipped`
    : `${summary.written.length} written, ${summary.deleted.length} deleted, ${summary.conflicts.length} conflicts, ${summary.skipped.length} skipped`;
  Logger.success(`${label}: ${counts} (remote version ${remoteVersion}).`);
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
