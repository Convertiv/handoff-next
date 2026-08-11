import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDataProvider } from '@/lib/data';
import { getDb } from '@/lib/db';
import { handoffComponentSources } from '@/lib/db/schema';
import { isPostgres } from '@/lib/db/dialect';
import { auditContractRender, type RenderFinding } from '@/lib/contract-render-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Where this registry's contracts and its actual render disagree — the shape half of Phase F's `F.-1`.
 *
 * Read-only. Three checks, all grounded in failures already seen in production rather than invented here; see
 * `lib/contract-render-audit.ts` for what each one means and, importantly, what this does **not** do (it does
 * not render React — there is no server-side React render in this codebase to assert against).
 *
 * **Templates are optional.** Checks 2 and 3 need the Handlebars source, read from `handoff_component_source`
 * when a workspace has pushed it. That table is empty on registries that only sync built artifacts, in which
 * case those checks are silently skipped and `withTemplate` reports how many were available — a zero there
 * means "not checked", not "clean".
 *
 * **Auth: an admin session, or `HANDOFF_SYNC_SECRET` as bearer** — same posture as `field-bridge-audit` and
 * `contract-limit-audit`, which this deliberately mirrors.
 *
 * Query params: `?component=blog_header`, `?code=unfeedable-preview`, `?limit=200`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  const isAdmin = session?.user?.id ? session.user.role === 'admin' : false;

  if (!isAdmin) {
    const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!secret || token !== secret) {
      return NextResponse.json(
        {
          error: session?.user?.id
            ? 'Forbidden — this diagnostic is admin-only.'
            : 'Unauthorized — sign in as an admin, or send HANDOFF_SYNC_SECRET as a bearer token.',
        },
        { status: session?.user?.id ? 403 : 401 }
      );
    }
  }

  const url = new URL(request.url);
  const only = url.searchParams.get('component')?.trim() || '';
  const codeFilter = url.searchParams.get('code')?.trim() || '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 2000);

  const provider = getDataProvider();
  const list = await provider.getComponents();

  /** Pushed template sources, keyed by component. Absent on a registry that only syncs built artifacts. */
  const templates = new Map<string, string>();
  if (isPostgres()) {
    try {
      const db = getDb();
      const rows = await db
        .select({
          componentId: handoffComponentSources.componentId,
          filePath: handoffComponentSources.filePath,
          content: handoffComponentSources.content,
        })
        .from(handoffComponentSources)
        .where(eq(handoffComponentSources.filePath, 'template.hbs'));
      for (const row of rows) templates.set(row.componentId, row.content);
    } catch {
      /* No pushed sources — checks 2 and 3 simply do not run. Reported as `withTemplate: 0`. */
    }
  }

  const findings: RenderFinding[] = [];
  let scanned = 0;
  let withTemplate = 0;

  for (const row of list) {
    const id = String((row as { id?: unknown }).id ?? '');
    if (!id || (only && id !== only)) continue;
    const comp = (await provider.getComponent(id)) as Record<string, unknown> | null;
    if (!comp) continue;
    scanned += 1;

    const template = templates.get(id) ?? null;
    if (template) withTemplate += 1;
    findings.push(
      ...auditContractRender({ componentId: id, properties: comp.properties, previews: comp.previews, template })
    );
  }

  const filtered = codeFilter ? findings.filter((f) => f.code === codeFilter) : findings;
  const byCode: Record<string, number> = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;

  return NextResponse.json({
    scanned,
    /** Zero means checks 2 and 3 did not run, not that they passed. */
    withTemplate,
    componentsWithFindings: new Set(findings.map((f) => f.componentId)).size,
    byCode,
    /**
     * The subset that **crashes** rather than degrading: a declared array holding a serialized element makes the
     * component throw on `.filter`. Worth separating, because the rest merely render the component's default.
     */
    crashesWhenFedBack: findings.filter((f) => f.message.includes('.filter')).length,
    total: findings.length,
    returned: Math.min(filtered.length, limit),
    findings: filtered.slice(0, limit),
  });
}
