import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/figma-plugin/auth/revoke — logout for the Figma plugin (P1.6, spec §4).
 * Device-flow access tokens are stateless HS256 JWTs with no server-side session
 * after issuance, so revocation is best-effort: the client discards the token. We
 * always return 204 (per the contract) so the plugin can treat logout as successful.
 * CORS is applied by proxy.ts.
 */
export async function DELETE(): Promise<Response> {
  return new NextResponse(null, { status: 204 });
}
