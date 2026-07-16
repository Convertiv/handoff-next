import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/figma-plugin/auth/revoke — RFC 7009-style revocation for the Figma
 * plugin (P1.6c). Device-flow access tokens are stateless HS256 JWTs with no
 * server-side session after issuance, so revocation is best-effort: the client
 * discards the token. Per RFC 7009 §2.2 an unsupported/unknown token still returns
 * 200 so the client can treat logout as successful. Accepts `{ token }`.
 */
export async function POST(request: Request): Promise<Response> {
  // Accept and ignore the body shape — always succeed (client-side discard).
  try {
    await request.text();
  } catch {
    /* ignore */
  }
  return NextResponse.json({ ok: true });
}
