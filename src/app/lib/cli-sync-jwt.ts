import { createHmac, timingSafeEqual } from 'node:crypto';

/** Preferred audience for new tokens (CLI + MCP). */
export const HANDOFF_API_JWT_AUD = 'handoff-api';
/** @deprecated Legacy CLI tokens — still accepted on verify. */
export const CLI_SYNC_JWT_AUD = 'handoff-cli-sync';
export const MCP_JWT_AUD = 'handoff-mcp';

const ACCEPTED_AUDIENCES = [HANDOFF_API_JWT_AUD, CLI_SYNC_JWT_AUD, MCP_JWT_AUD] as const;

function base64UrlEncode(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

export type CliSyncJwtPayload = {
  sub: string;
  role: string;
  scp: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function getCliJwtSecret(): string | null {
  const explicit = process.env.HANDOFF_CLI_JWT_SECRET?.trim();
  if (explicit) return explicit;
  const auth = process.env.AUTH_SECRET?.trim();
  if (auth) return `${auth}:handoff-cli-sync`;
  return null;
}

export function signCliAccessToken(payload: Omit<CliSyncJwtPayload, 'aud' | 'iat' | 'exp'> & { ttlSeconds?: number }): string {
  const secret = getCliJwtSecret();
  if (!secret) {
    throw new Error('Set HANDOFF_CLI_JWT_SECRET or AUTH_SECRET to issue CLI sync tokens.');
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = payload.ttlSeconds ?? 3600;
  const full: CliSyncJwtPayload = {
    sub: payload.sub,
    role: payload.role,
    scp: payload.scp,
    iss: payload.iss,
    aud: HANDOFF_API_JWT_AUD,
    iat: now,
    exp: now + ttl,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(full));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export type VerifyCliJwtResult =
  | { ok: true; payload: CliSyncJwtPayload }
  | { ok: false; reason: string };

export function verifyCliAccessToken(token: string, expectedIss: string): VerifyCliJwtResult {
  const secret = getCliJwtSecret();
  if (!secret) return { ok: false, reason: 'server_not_configured' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, sig] = parts;
  const expectedSig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expectedSig, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload: CliSyncJwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(p)) as CliSyncJwtPayload;
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (!ACCEPTED_AUDIENCES.includes(payload.aud as (typeof ACCEPTED_AUDIENCES)[number])) {
    return { ok: false, reason: 'bad_aud' };
  }
  if (payload.iss !== expectedIss) return { ok: false, reason: 'bad_iss' };
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return { ok: false, reason: 'expired' };
  if (!payload.sub || typeof payload.scp !== 'string') return { ok: false, reason: 'bad_claims' };
  return { ok: true, payload };
}

export function jwtScopesInclude(scp: string, scope: string): boolean {
  return scp.split(/\s+/).filter(Boolean).includes(scope);
}

export function cliJwtScopesIncludeWrite(scp: string): boolean {
  return jwtScopesInclude(scp, 'sync:write');
}

/** @deprecated Use HANDOFF_API_JWT_AUD */
export { CLI_SYNC_JWT_AUD as AUD };
