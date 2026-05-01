import { NextRequest, NextResponse } from 'next/server';

export type ProxyAiToCloudOptions = {
  /** Forwarded for cloud-side rate limiting when auth is bearer (local proxy). */
  actingUserId?: string;
};

function cloudBaseUrl(): string | null {
  const u = process.env.HANDOFF_CLOUD_URL?.trim();
  if (!u) return null;
  return u.replace(/\/$/, '');
}

function cloudToken(): string | null {
  const t = process.env.HANDOFF_CLOUD_TOKEN?.trim();
  return t || null;
}

/**
 * Forward an AI API request to HANDOFF_CLOUD_URL with HANDOFF_CLOUD_TOKEN.
 * Caller must have already verified local session (browser) before invoking.
 */
export async function proxyAiToCloud(
  request: NextRequest,
  opts: ProxyAiToCloudOptions = {}
): Promise<NextResponse> {
  const base = cloudBaseUrl();
  const token = cloudToken();
  if (!base || !token) {
    return NextResponse.json(
      { error: 'HANDOFF_CLOUD_URL and HANDOFF_CLOUD_TOKEN must be set for AI proxy.' },
      { status: 503 }
    );
  }

  const src = new URL(request.url);
  const url = `${base}${src.pathname}${src.search}`;
  const method = request.method;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  if (opts.actingUserId?.trim()) {
    headers.set('X-Handoff-Proxy-Acting-User', opts.actingUserId.trim());
  }

  const contentType = request.headers.get('content-type');
  if (contentType && method !== 'GET' && method !== 'HEAD') {
    headers.set('content-type', contentType);
  }

  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fetch failed';
    return NextResponse.json({ error: `Cloud AI unreachable: ${msg}` }, { status: 502 });
  }

  const outCt = upstream.headers.get('content-type') || 'application/json';
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: upstream.status,
    headers: { 'content-type': outCt },
  });
}
