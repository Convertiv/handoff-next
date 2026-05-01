import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { accounts } from '../db/schema';

type FigmaAccountRow = typeof accounts.$inferSelect;

const FIGMA_PROVIDER_ID = 'figma';
const FIGMA_TOKEN_ENDPOINT = 'https://api.figma.com/v1/oauth/token';

function assertFigmaOauthEnv() {
  if (!process.env.AUTH_FIGMA_ID || !process.env.AUTH_FIGMA_SECRET) {
    throw new Error('Figma OAuth is not configured on this server.');
  }
}

function isExpired(expiresAt?: number | null): boolean {
  if (!expiresAt) return true;
  const now = Math.floor(Date.now() / 1000);
  return expiresAt <= now + 60;
}

export async function getFigmaAccountForUser(userId: string): Promise<FigmaAccountRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, FIGMA_PROVIDER_ID)))
    .limit(1);
  return row ?? null;
}

export async function hasFigmaConnection(userId: string): Promise<boolean> {
  const account = await getFigmaAccountForUser(userId);
  return Boolean(account?.access_token || account?.refresh_token);
}

async function refreshFigmaAccessToken(account: FigmaAccountRow): Promise<FigmaAccountRow> {
  assertFigmaOauthEnv();
  if (!account.refresh_token) {
    throw new Error('Figma token expired and no refresh token is available. Reconnect Figma.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    client_id: process.env.AUTH_FIGMA_ID as string,
    client_secret: process.env.AUTH_FIGMA_SECRET as string,
  });

  const res = await fetch(FIGMA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Figma token refresh failed (${res.status}): ${msg}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };

  const expiresAt = json.expires_in ? Math.floor(Date.now() / 1000) + json.expires_in : account.expires_at;

  const db = getDb();

  await db
    .update(accounts)
    .set({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? account.refresh_token,
      token_type: json.token_type ?? account.token_type,
      scope: json.scope ?? account.scope,
      expires_at: expiresAt ?? null,
    })
    .where(and(eq(accounts.provider, account.provider), eq(accounts.providerAccountId, account.providerAccountId)));

  const [updated] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, account.provider), eq(accounts.providerAccountId, account.providerAccountId)))
    .limit(1);

  if (!updated) {
    throw new Error('Failed to persist refreshed Figma token.');
  }

  return updated;
}

export async function getValidFigmaAccessTokenForUser(userId: string): Promise<string> {
  const account = await getFigmaAccountForUser(userId);
  if (!account) {
    throw new Error('Figma is not connected for this user.');
  }

  if (!isExpired(account.expires_at) && account.access_token) {
    return account.access_token;
  }

  const refreshed = await refreshFigmaAccessToken(account);
  if (!refreshed.access_token) {
    throw new Error('Figma token refresh succeeded but no access token was returned.');
  }

  return refreshed.access_token;
}
