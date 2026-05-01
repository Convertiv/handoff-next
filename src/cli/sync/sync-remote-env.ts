/**
 * Remote Handoff instance for `handoff sync:push` / `handoff sync:pull`.
 * Prefer HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN; fall back to legacy HANDOFF_SYNC_*.
 */
export function getSyncRemoteUrl(): string {
  const u = process.env.HANDOFF_CLOUD_URL?.trim() || process.env.HANDOFF_SYNC_URL?.trim();
  if (!u) {
    throw new Error(
      'Set HANDOFF_CLOUD_URL (or legacy HANDOFF_SYNC_URL) to your team Handoff origin, e.g. https://docs.example.com'
    );
  }
  return u.replace(/\/$/, '');
}

export function getSyncRemoteSecret(): string {
  const s = process.env.HANDOFF_CLOUD_TOKEN?.trim() || process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!s) {
    throw new Error('Set HANDOFF_CLOUD_TOKEN (or legacy HANDOFF_SYNC_SECRET) for sync authentication.');
  }
  return s;
}
