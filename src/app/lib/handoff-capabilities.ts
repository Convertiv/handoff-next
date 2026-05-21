import 'server-only';

export type HandoffCapabilities = {
  /** Filesystem-backed docs, components, tokens work locally. */
  localFilesystem: boolean;
  hasRemoteApi: boolean;
  hasRemoteAuth: boolean;
  remoteReachable: boolean | null;
  designWorkbench: boolean;
  designLibrary: boolean;
  aiFeatures: boolean;
  adminBuildLogs: boolean;
  adminAiCost: boolean;
  adminUsers: boolean;
  figmaOAuth: boolean;
  inAppDbEditing: boolean;
  mcp: boolean;
};

let cachedReachable: { at: number; ok: boolean } | null = null;
const REACHABLE_TTL_MS = 60_000;

export function getHandoffCapabilities(): HandoffCapabilities {
  const hasRemoteApi = Boolean(process.env.HANDOFF_CLOUD_URL?.trim());
  const hasRemoteAuth = Boolean(
    process.env.HANDOFF_CLOUD_TOKEN?.trim() || process.env.HANDOFF_SYNC_SECRET?.trim()
  );
  const isHosted = Boolean(process.env.DATABASE_URL?.trim());

  const cloudFeatures = isHosted || (hasRemoteApi && hasRemoteAuth);

  return {
    localFilesystem: true,
    hasRemoteApi: isHosted || hasRemoteApi,
    hasRemoteAuth: isHosted || hasRemoteAuth,
    remoteReachable: cachedReachable ? cachedReachable.ok : null,
    designWorkbench: cloudFeatures,
    designLibrary: cloudFeatures,
    aiFeatures: cloudFeatures,
    adminBuildLogs: isHosted,
    adminAiCost: isHosted,
    adminUsers: isHosted,
    figmaOAuth: isHosted,
    inAppDbEditing: isHosted,
    mcp: isHosted,
  };
}

export async function probeRemoteHandoffReachable(): Promise<boolean> {
  const base = process.env.HANDOFF_CLOUD_URL?.trim().replace(/\/$/, '');
  if (!base) return false;
  const now = Date.now();
  if (cachedReachable && now - cachedReachable.at < REACHABLE_TTL_MS) {
    return cachedReachable.ok;
  }
  try {
    const res = await fetch(`${base}/api/sync/status`, {
      method: 'GET',
      headers: process.env.HANDOFF_CLOUD_TOKEN
        ? { Authorization: `Bearer ${process.env.HANDOFF_CLOUD_TOKEN.trim()}` }
        : {},
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.ok || res.status === 401;
    cachedReachable = { at: now, ok };
    return ok;
  } catch {
    cachedReachable = { at: now, ok: false };
    return false;
  }
}

export const REMOTE_REQUIRED_CODE = 'REMOTE_REQUIRED';

/** Returns a 503 response when this process has no Postgres (local filesystem-only mode). */
export function requireHostedDatabase(): Response | null {
  if (!process.env.DATABASE_URL?.trim()) {
    return remoteRequiredResponse();
  }
  return null;
}

export function remoteRequiredResponse(message?: string): Response {
  return Response.json(
    {
      error: message ?? 'This feature requires a hosted Handoff API. Set HANDOFF_CLOUD_URL and run handoff-app login.',
      code: REMOTE_REQUIRED_CODE,
    },
    { status: 503 }
  );
}
