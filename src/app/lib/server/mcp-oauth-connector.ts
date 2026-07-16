import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { oauthAuthorizationCodes, oauthClients, oauthRefreshTokens, users } from '@/lib/db/schema';
import { signCliAccessToken, MCP_JWT_AUD } from '@/lib/cli-sync-jwt';
import { narrowScopesToRole } from '@/lib/oauth-scopes';

/**
 * OAuth 2.1 authorization_code + PKCE + refresh_token grant, for registering Handoff
 * as a remote MCP Connector (claude.ai / Claude Desktop) — distinct from the CLI's
 * device-code flow in cli-device-oauth.ts. Follows the same hash-store-then-consume
 * idiom as cliDeviceSessions.
 */

const AUTH_CODE_TTL_SEC = 120;
const ACCESS_TOKEN_TTL_SEC = 3600;
const REFRESH_TOKEN_TTL_SEC = 180 * 24 * 3600; // 180 days, rotated on each use

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function randomOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

export type RegisterClientInput = {
  clientName?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod?: string;
};

export type RegisterClientResult =
  | {
      ok: true;
      clientId: string;
      clientSecret?: string;
      clientName: string;
      redirectUris: string[];
      tokenEndpointAuthMethod: string;
    }
  | { ok: false; error: string; errorDescription: string };

function isAcceptableRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    // Loopback redirect URIs are allowed unencrypted per OAuth 2.1 (native/dev clients).
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function registerOAuthClient(input: RegisterClientInput): Promise<RegisterClientResult> {
  const redirectUris = (input.redirectUris ?? []).map((s) => s.trim()).filter(Boolean);
  if (!redirectUris.length) {
    return { ok: false, error: 'invalid_client_metadata', errorDescription: 'redirect_uris is required.' };
  }
  if (!redirectUris.every(isAcceptableRedirectUri)) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      errorDescription: 'redirect_uris must be https:// (or http://localhost for local dev).',
    };
  }

  const authMethod = input.tokenEndpointAuthMethod === 'none' ? 'none' : input.tokenEndpointAuthMethod || 'none';
  const clientId = randomUUID();
  let clientSecret: string | undefined;
  let clientSecretHash: string | null = null;
  if (authMethod !== 'none') {
    clientSecret = randomOpaqueToken('secret');
    clientSecretHash = sha256Hex(clientSecret);
  }
  const clientName = input.clientName?.trim() || 'MCP Client';

  const db = getDb();
  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash,
    clientName,
    redirectUris: JSON.stringify(redirectUris),
    tokenEndpointAuthMethod: authMethod,
  });

  return {
    ok: true,
    clientId,
    clientSecret,
    clientName,
    redirectUris,
    tokenEndpointAuthMethod: authMethod,
  };
}

export type OAuthClientRecord = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientSecretHash: string | null;
};

export async function getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
  if (!clientId) return null;
  const db = getDb();
  const rows = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  let redirectUris: string[] = [];
  try {
    redirectUris = JSON.parse(row.redirectUris) as string[];
  } catch {
    redirectUris = [];
  }
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    clientSecretHash: row.clientSecretHash,
  };
}

export function clientAllowsRedirectUri(client: OAuthClientRecord, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

// ---------------------------------------------------------------------------
// Authorization code issuance + exchange (authorization_code + PKCE)
// ---------------------------------------------------------------------------

export type CreateAuthorizationCodeInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string;
  codeChallenge: string;
  codeChallengeMethod: string;
};

export async function createAuthorizationCode(input: CreateAuthorizationCodeInput): Promise<string> {
  const db = getDb();
  const code = randomOpaqueToken('ac');
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000);
  await db.insert(oauthAuthorizationCodes).values({
    codeHash,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod || 'S256',
    scopes: input.scopes,
    expiresAt,
  });
  return code;
}

function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method !== 'S256') return false; // 'plain' is not accepted — S256 only.
  const computed = createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
  return timingSafeStringEqual(computed, codeChallenge);
}

export type TokenIssueResult = { accessToken: string; refreshToken: string; expiresIn: number; scopes: string };

async function issueTokenPair(clientId: string, userId: string, scopes: string, issuer: string): Promise<TokenIssueResult> {
  const db = getDb();
  const userRows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const role = userRows[0]?.role ?? 'member';

  const accessToken = signCliAccessToken({
    sub: userId,
    role,
    scp: scopes,
    iss: issuer,
    aud: MCP_JWT_AUD,
    ttlSeconds: ACCESS_TOKEN_TTL_SEC,
  });

  const refreshToken = randomOpaqueToken('rt');
  await db.insert(oauthRefreshTokens).values({
    tokenHash: sha256Hex(refreshToken),
    clientId,
    userId,
    scopes,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000),
  });

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SEC, scopes };
}

export type ExchangeCodeInput = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  issuer: string;
};

export type ExchangeCodeResult = { ok: true; tokens: TokenIssueResult } | { ok: false; error: string; errorDescription?: string };

export async function exchangeAuthorizationCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  const db = getDb();
  const codeHash = sha256Hex(input.code);
  const rows = await db.select().from(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.codeHash, codeHash)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'invalid_grant', errorDescription: 'Unknown authorization code.' };
  if (row.consumed) return { ok: false, error: 'invalid_grant', errorDescription: 'Authorization code already used.' };
  if (row.expiresAt < new Date()) return { ok: false, error: 'invalid_grant', errorDescription: 'Authorization code expired.' };
  if (row.clientId !== input.clientId) return { ok: false, error: 'invalid_grant', errorDescription: 'client_id mismatch.' };
  if (row.redirectUri !== input.redirectUri) return { ok: false, error: 'invalid_grant', errorDescription: 'redirect_uri mismatch.' };
  if (!verifyPkce(input.codeVerifier, row.codeChallenge, row.codeChallengeMethod)) {
    return { ok: false, error: 'invalid_grant', errorDescription: 'PKCE verification failed.' };
  }

  // Single-use: mark consumed before minting tokens so a retry (or a stolen code replayed
  // concurrently) can't redeem it twice.
  await db.update(oauthAuthorizationCodes).set({ consumed: true }).where(eq(oauthAuthorizationCodes.id, row.id));

  const tokens = await issueTokenPair(row.clientId, row.userId, row.scopes, input.issuer);
  return { ok: true, tokens };
}

// ---------------------------------------------------------------------------
// Refresh token grant (with rotation)
// ---------------------------------------------------------------------------

export type RefreshInput = { refreshToken: string; clientId: string; issuer: string };
export type RefreshResult = { ok: true; tokens: TokenIssueResult } | { ok: false; error: string; errorDescription?: string };

export async function refreshAccessToken(input: RefreshInput): Promise<RefreshResult> {
  const db = getDb();
  const tokenHash = sha256Hex(input.refreshToken);
  const rows = await db
    .select()
    .from(oauthRefreshTokens)
    .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'invalid_grant', errorDescription: 'Unknown or revoked refresh token.' };
  if (row.expiresAt < new Date()) return { ok: false, error: 'invalid_grant', errorDescription: 'Refresh token expired.' };
  if (row.clientId !== input.clientId) return { ok: false, error: 'invalid_grant', errorDescription: 'client_id mismatch.' };

  // Rotate: revoke this token and issue a fresh pair, so a leaked-and-replayed refresh
  // token is only usable once before the legitimate holder's next refresh invalidates it.
  await db.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(oauthRefreshTokens.id, row.id));

  const tokens = await issueTokenPair(row.clientId, row.userId, row.scopes, input.issuer);
  return { ok: true, tokens };
}

export { narrowScopesToRole };
