import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-time cleanup of churn-duplicate component versions left behind by the
 * pre-fix over-sensitive diff (validationResults/sharedStyles churn cut a new
 * version on every push). Collapses consecutive versions that differ only by
 * those volatile fields; keeps the first version and every genuine change.
 *
 * SAFE BY DEFAULT — dry run unless `?apply=true` is passed. The dry run returns
 * exactly what WOULD be deleted (per-component version numbers + totals) so you
 * can review before committing. Run once per registry deployment (each has its
 * own DB).
 *
 * Auth: HANDOFF_SYNC_SECRET bearer token (same as /api/admin/migrate).
 *
 * Usage:
 *   # preview
 *   curl -X POST "https://your-registry.vercel.app/api/admin/cleanup-versions" \
 *        -H "Authorization: Bearer $HANDOFF_SYNC_SECRET"
 *   # apply
 *   curl -X POST "https://your-registry.vercel.app/api/admin/cleanup-versions?apply=true" \
 *        -H "Authorization: Bearer $HANDOFF_SYNC_SECRET"
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'HANDOFF_SYNC_SECRET is not set on this deployment — cannot authenticate cleanup calls.' },
      { status: 500 }
    );
  }

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized — bearer token must match HANDOFF_SYNC_SECRET' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json({ error: 'DATABASE_URL not set — no versions to clean in workspace mode.' }, { status: 400 });
  }

  // Dry run unless explicitly applied via ?apply=true.
  const apply = new URL(request.url).searchParams.get('apply') === 'true';

  try {
    const { cleanupRedundantComponentVersions } = await import('@/lib/db/component-version-queries');
    const report = await cleanupRedundantComponentVersions({ dryRun: !apply });
    return NextResponse.json({
      ok: true,
      applied: apply,
      message: apply
        ? `Deleted ${report.versionsDeleted} redundant version(s) across ${report.componentsAffected} component(s).`
        : `Dry run — ${report.versionsDeleted} redundant version(s) across ${report.componentsAffected} component(s) would be deleted. Re-run with ?apply=true to delete.`,
      report,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
