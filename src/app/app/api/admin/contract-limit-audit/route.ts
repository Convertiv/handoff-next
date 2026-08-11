import { NextResponse, type NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data';
import { auditContractLimits, type LimitFinding } from '@/lib/contract-limit-audit';
import { contentLengthPlan, summarizePlan, type PlanEntry } from '@/lib/content-length-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Which content limits in this registry contradict themselves — the first check of Phase F's `F.-1`.
 *
 * Read-only. The oracle is each component's own previews: a cap that rejects the value the component ships is
 * wrong without anyone needing the real content corpus, so this can be acted on directly rather than argued
 * about. See `lib/contract-limit-audit.ts` for what it does and does not claim.
 *
 * **Why it needs to be repeatable.** The first run of this logic (2026-08-10, against SS&C) found **45 of 83
 * components** with problems, including **36 fields whose cap rejects the component's own preview value** — the
 * class of bug that blocked the ALPS migration, where `blog_header.title` capped titles at 25 characters and 177
 * of 240 real titles exceeded it. That was a local script; a number nobody can re-run is a number that goes
 * stale, and the root cause (the scaffolding template shipping `{min: 5, max: 25}` on every property) means the
 * count only stays down if it can be re-checked.
 *
 * **Auth: an admin session, or `HANDOFF_SYNC_SECRET` as bearer** — same posture and reasoning as
 * `field-bridge-audit`, which this deliberately mirrors: session first so it runs from a logged-in browser
 * without fetching a deployment secret, bearer for CI.
 *
 * **`?plan=1` adds the proposal** (`lib/content-length-plan.ts`): what each limit should become, and why. The
 * audit half states only facts and stays that way; the plan half states an opinion, asked for explicitly (Brad,
 * 2026-08-11 — "step 2 is to have you take a best guess at length changes, and then I'll refine"). Keeping them in
 * one endpoint means the proposal is always read next to the evidence it was derived from.
 *
 * **Scope is "contracts that declare limits", which is Handlebars in practice.** A React component's fields are
 * inferred and carry no `rules`, so it contributes nothing and is counted separately rather than filtered by
 * format — a React component that *does* declare rules deserves the same check.
 *
 * Query params: `?component=blog_header` for one, `?code=preview-exceeds-max` to filter, `?limit=200`,
 * `?plan=1` for the proposal, `?action=raise-max` to filter it.
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
  const wantPlan = url.searchParams.get('plan') === '1';
  const actionFilter = url.searchParams.get('action')?.trim() || '';

  const provider = getDataProvider();
  const list = await provider.getComponents();

  const findings: LimitFinding[] = [];
  const plan: PlanEntry[] = [];
  let scanned = 0;
  let declaringLimits = 0;
  let inferredOnly = 0;

  for (const row of list) {
    const id = String((row as { id?: unknown }).id ?? '');
    if (!id || (only && id !== only)) continue;

    const comp = (await provider.getComponent(id)) as Record<string, unknown> | null;
    if (!comp) continue;
    scanned += 1;

    const found = auditContractLimits({ componentId: id, properties: comp.properties, previews: comp.previews });
    // Counted from the contract, not from findings — "declares limits and is fine" is a distinct, useful number.
    if (JSON.stringify(comp.properties ?? {}).includes('"content"')) declaringLimits += 1;
    else inferredOnly += 1;
    findings.push(...found);

    if (wantPlan) {
      plan.push(...contentLengthPlan({ componentId: id, properties: comp.properties, previews: comp.previews }));
    }
  }

  const filtered = codeFilter ? findings.filter((f) => f.code === codeFilter) : findings;
  const byCode: Record<string, number> = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;

  const planned = actionFilter ? plan.filter((e) => e.action === actionFilter) : plan;

  return NextResponse.json({
    scanned,
    declaringLimits,
    /** Components with no declared limits — inferred fields, i.e. React. Out of scope rather than passing. */
    inferredOnly,
    componentsWithFindings: new Set(findings.map((f) => f.componentId)).size,
    byCode,
    /**
     * The one to act on first: these are not judgement calls. The component ships a value its own contract
     * would reject, so either the limit or the preview is wrong and both are the component's own.
     */
    selfContradicting: byCode['preview-exceeds-max'] ?? 0,
    total: findings.length,
    returned: Math.min(filtered.length, limit),
    findings: filtered.slice(0, limit),
    ...(wantPlan
      ? {
          planSummary: summarizePlan(plan),
          planReturned: Math.min(planned.length, limit),
          plan: planned.slice(0, limit),
        }
      : {}),
  });
}
