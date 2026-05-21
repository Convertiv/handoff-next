import 'server-only';

function cloudBaseUrl(): string | null {
  const u = process.env.HANDOFF_CLOUD_URL?.trim() || process.env.HANDOFF_SYNC_URL?.trim();
  return u ? u.replace(/\/$/, '') : null;
}

function cloudBearer(): string | null {
  return process.env.HANDOFF_CLOUD_TOKEN?.trim() || process.env.HANDOFF_SYNC_SECRET?.trim() || null;
}

/** Proxy a request to the hosted Handoff origin (local dev hybrid mode). */
export async function proxyToRemoteHandoff(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = cloudBaseUrl();
  if (!base) {
    const { remoteRequiredResponse } = await import('@/lib/handoff-capabilities');
    return remoteRequiredResponse();
  }
  const token = cloudBearer();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { ...init, headers });
}

export function hasRemoteHandoffConfigured(): boolean {
  return Boolean(cloudBaseUrl());
}
