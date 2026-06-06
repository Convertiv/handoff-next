import { NextResponse, type NextRequest } from 'next/server';
import { ensureMigrationsApplied } from '@/lib/db/auto-migrate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual migration trigger. Useful when instrumentation.ts didn't fire at
 * cold start (e.g. logs show no instrumentation register message) and you
 * need to apply migrations explicitly. Also serves as a diagnostic — the
 * response includes the resolved migrations folder path and the result.
 *
 * Auth: requires HANDOFF_SYNC_SECRET as bearer token. This is a sensitive
 * operation (modifies schema) so we don't allow unauthenticated access even
 * on fresh registries — the secret is set via env var on deploy.
 *
 * Usage:
 *   curl -X POST https://your-registry.vercel.app/api/admin/migrate \
 *        -H "Authorization: Bearer $HANDOFF_SYNC_SECRET"
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'HANDOFF_SYNC_SECRET is not set on this deployment — cannot authenticate manual migration calls.' },
      { status: 500 }
    );
  }

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized — bearer token must match HANDOFF_SYNC_SECRET' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json({ error: 'DATABASE_URL not set — nothing to migrate in workspace mode.' }, { status: 400 });
  }

  try {
    await ensureMigrationsApplied();
    return NextResponse.json({ ok: true, message: 'Migrations applied (see function logs for details).' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
