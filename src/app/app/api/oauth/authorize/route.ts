import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { clientAllowsRedirectUri, createAuthorizationCode, getOAuthClient } from '@/lib/server/mcp-oauth-connector';
import { narrowScopesToRole } from '@/lib/oauth-scopes';

export const dynamic = 'force-dynamic';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const PAGE_STYLE = [
  'body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#111}',
  '.card{border:1px solid #e5e7eb;border-radius:12px;padding:1.75rem}',
  'h1{font-size:1.125rem;margin:0 0 .5rem}p{color:#4b5563;font-size:.925rem;line-height:1.5}',
  'ul{color:#4b5563;font-size:.875rem}',
  '.row{display:flex;gap:.75rem;margin-top:1.5rem}',
  'button{flex:1;padding:.6rem 1rem;border-radius:8px;border:1px solid #d1d5db;font-size:.925rem;cursor:pointer}',
  'button.approve{background:#111;color:#fff;border-color:#111}',
].join('');

function htmlPage(title: string, body: string): NextResponse {
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${PAGE_STYLE}</style></head>` +
    `<body><div class="card">${body}</div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function errorRedirect(redirectUri: string, error: string, state: string | null): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url.toString(), 302);
}

type AuthorizeParams = {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
};

function readParams(params: URLSearchParams): AuthorizeParams {
  return {
    responseType: params.get('response_type'),
    clientId: params.get('client_id'),
    redirectUri: params.get('redirect_uri'),
    scope: params.get('scope'),
    state: params.get('state'),
    codeChallenge: params.get('code_challenge'),
    codeChallengeMethod: params.get('code_challenge_method'),
  };
}

/**
 * OAuth 2.1 authorization endpoint. Renders a consent screen for the signed-in
 * Handoff user; redirects to /login (with callbackUrl back here) if not signed in.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = readParams(url.searchParams);

  if (p.responseType !== 'code' || !p.clientId || !p.redirectUri) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'response_type=code, client_id, and redirect_uri are required.' }, { status: 400 });
  }

  const client = await getOAuthClient(p.clientId);
  if (!client) {
    return NextResponse.json({ error: 'invalid_client', error_description: 'Unknown client_id.' }, { status: 400 });
  }
  if (!clientAllowsRedirectUri(client, p.redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client.' }, { status: 400 });
  }
  if (!p.codeChallenge || p.codeChallengeMethod !== 'S256') {
    return errorRedirect(p.redirectUri, 'invalid_request', p.state);
  }

  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = `${url.pathname}${url.search}`;
    return NextResponse.redirect(`${url.origin}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, 302);
  }

  const requestedScopes = narrowScopesToRole(p.scope ?? undefined, session.user.role ?? 'member').split(' ').filter(Boolean);

  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const body =
    `<h1>Authorize ${escapeHtml(client.clientName)}</h1>` +
    `<p>Signed in as <strong>${escapeHtml(session.user.email ?? session.user.id)}</strong>. This app is requesting access to your Handoff design system:</p>` +
    `<ul>${requestedScopes.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul>` +
    `<form method="POST">` +
    hidden('client_id', p.clientId) +
    hidden('redirect_uri', p.redirectUri) +
    hidden('scope', requestedScopes.join(' ')) +
    hidden('state', p.state ?? '') +
    hidden('code_challenge', p.codeChallenge) +
    hidden('code_challenge_method', p.codeChallengeMethod) +
    `<div class="row"><button type="submit" name="decision" value="deny">Deny</button>` +
    `<button class="approve" type="submit" name="decision" value="approve">Approve</button></div></form>`;

  return htmlPage(`Authorize ${client.clientName}`, body);
}

/** User's consent decision. */
export async function POST(request: Request) {
  const raw = await request.text();
  const fields = new URLSearchParams(raw);
  const p: AuthorizeParams = {
    responseType: 'code',
    clientId: fields.get('client_id'),
    redirectUri: fields.get('redirect_uri'),
    scope: fields.get('scope'),
    state: fields.get('state'),
    codeChallenge: fields.get('code_challenge'),
    codeChallengeMethod: fields.get('code_challenge_method'),
  };
  const decision = fields.get('decision');

  if (!p.clientId || !p.redirectUri || !p.codeChallenge) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const client = await getOAuthClient(p.clientId);
  if (!client || !clientAllowsRedirectUri(client, p.redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Unknown client or redirect_uri.' }, { status: 400 });
  }

  if (decision !== 'approve') {
    return errorRedirect(p.redirectUri, 'access_denied', p.state);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return errorRedirect(p.redirectUri, 'access_denied', p.state);
  }

  // Re-narrow server-side rather than trusting the hidden `scope` field verbatim.
  const scopes = narrowScopesToRole(p.scope ?? undefined, session.user.role ?? 'member');

  const code = await createAuthorizationCode({
    clientId: p.clientId,
    userId: session.user.id,
    redirectUri: p.redirectUri,
    scopes,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: p.codeChallengeMethod || 'S256',
  });

  const redirect = new URL(p.redirectUri);
  redirect.searchParams.set('code', code);
  if (p.state) redirect.searchParams.set('state', p.state);
  return NextResponse.redirect(redirect.toString(), 302);
}
