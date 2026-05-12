import { cliAuthMatchesRemote, cliAuthTokenStillValid, readCliAuth } from './cli-auth-store.js';

function normalizeRemoteUrl(u: string): string {
  return u.replace(/\/$/, '');
}

/**
 * Remote Handoff instance for `handoff sync:push` / `handoff sync:pull`.
 * Prefer HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN; fall back to legacy HANDOFF_SYNC_*.
 */
export function getSyncRemoteUrl(): string {
  const u = getSyncRemoteUrlOptional();
  if (!u) {
    throw new Error(
      'Set HANDOFF_CLOUD_URL (or legacy HANDOFF_SYNC_URL) to your team Handoff origin, e.g. https://docs.example.com — or run `handoff-app login --url ...` first.'
    );
  }
  return u;
}

/** Resolve remote URL from env or from `.handoff/cli-auth.json` after `login`. */
export async function resolveSyncRemoteUrl(workingPath: string): Promise<string> {
  const fromEnv = getSyncRemoteUrlOptional();
  if (fromEnv) return fromEnv;
  const auth = await readCliAuth(workingPath);
  if (auth?.remoteUrl) return normalizeRemoteUrl(auth.remoteUrl);
  throw new Error(
    'Set HANDOFF_CLOUD_URL (or legacy HANDOFF_SYNC_URL), or run `handoff-app login --url https://your-handoff.example.com`.'
  );
}

/** Optional URL override for `handoff-app login` before env is set. */
export function getSyncRemoteUrlOptional(): string | undefined {
  const u = process.env.HANDOFF_CLOUD_URL?.trim() || process.env.HANDOFF_SYNC_URL?.trim();
  return u ? u.replace(/\/$/, '') : undefined;
}

export function getSyncRemoteSecret(): string {
  const s = process.env.HANDOFF_CLOUD_TOKEN?.trim() || process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!s) {
    throw new Error(
      'Run `handoff-app login` for this project, or set HANDOFF_CLOUD_TOKEN (or legacy HANDOFF_SYNC_SECRET) for sync authentication.'
    );
  }
  return s;
}

/**
 * Bearer token for sync API: prefers OAuth CLI token from `.handoff/cli-auth.json` when valid for this remote URL.
 */
export async function getSyncBearerToken(workingPath: string): Promise<string> {
  const remoteUrl = await resolveSyncRemoteUrl(workingPath);
  const auth = await readCliAuth(workingPath);
  if (auth && cliAuthMatchesRemote(auth, remoteUrl) && cliAuthTokenStillValid(auth)) {
    return auth.accessToken;
  }
  const s = process.env.HANDOFF_CLOUD_TOKEN?.trim() || process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!s) {
    throw new Error(
      'Run `handoff-app login` for this project, or set HANDOFF_CLOUD_TOKEN (or legacy HANDOFF_SYNC_SECRET) for sync authentication.'
    );
  }
  return s;
}
