import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, isAuthorizationError, type MutateActor } from '@/lib/authz/policy';
import { getActorGrant } from '@/lib/db/grant-queries';
import { reviewPattern } from '@/lib/db/pattern-write';
import { getDbPatternById } from '@/lib/db/queries';
import { diffSubmissionAgainstTemplate, type PatternComponentEntry } from '@/lib/guest-editable';
import { checkGuardrails, guardrailsFromPatternData } from '@/lib/authoring-guardrails';

/**
 * What did the author actually change?
 *
 * The whole reason edits live in the override layer: the diff is computable without storing one. For each
 * block, the template's args are merged with the submission's overrides and compared field by field, so a
 * reviewer sees three changed strings instead of a wall of identical blocks.
 *
 * Only the fields a guest could edit are compared (`collectEditableText` / `collectImageSrcs`) — the same
 * derivation the authoring UI used to offer them, so the diff cannot claim a change in something that was
 * never editable.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  if (!computePermissions(actor, { ownerUserId: null, visibility: 'private' }, null).canApprove) {
    return NextResponse.json({ error: 'Only a maintainer can view submissions.' }, { status: 403 });
  }

  const { id } = await params;
  const row = await getDbPatternById((id ?? '').trim());
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = row.templateId ? await getDbPatternById(row.templateId) : null;
  const submissionBlocks = (Array.isArray(row.components) ? row.components : []) as PatternComponentEntry[];
  const templateBlocks = (Array.isArray(template?.components) ? template!.components : []) as PatternComponentEntry[];
  const values = ((row.data as { previews?: { default?: { values?: unknown[] } } })?.previews?.default?.values ??
    []) as unknown[];

  const blocks = diffSubmissionAgainstTemplate(submissionBlocks, templateBlocks, values);

  /**
   * Guardrail findings as annotations, not gates. Blocking ones cannot normally survive to review (the
   * submit path refuses them), so any that appear here mean the rules changed *after* submission — worth
   * showing a reviewer rather than hiding. Advisory ones — a missing alt, weak link text — are exactly
   * what a human should weigh.
   */
  const fromTemplate = guardrailsFromPatternData(template?.data);
  const config = Object.keys(fromTemplate).length ? fromTemplate : guardrailsFromPatternData(row.data);
  const findings = checkGuardrails(submissionBlocks, values, config);

  return NextResponse.json({
    submission: {
      id: row.id,
      title: row.title,
      status: row.status,
      visibility: row.visibility,
      templateId: row.templateId,
      templateTitle: template?.title ?? null,
      shareLinkToken: row.shareLinkToken,
      updatedAt: row.updatedAt,
    },
    blocks,
    changedCount: blocks.reduce((n, b) => n + b.changes.length, 0),
    findings,
  });
}

/**
 * Record a verdict on one submission: approve it, or send it back to the author.
 *
 * No gate of its own — `reviewPattern` owns it, so this route, the server action and the MCP tool cannot
 * drift apart. All this does is resolve the session actor and map the two failure kinds to status codes:
 * `AuthorizationError` → 403, everything else the core refuses (wrong status, lost race) → 409, since
 * those mean the queue view was stale rather than that the caller lacked rights.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const patternId = (id ?? '').trim();
  if (!patternId) return NextResponse.json({ error: 'A page id is required.' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { decision?: unknown; message?: unknown };
  const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : null;
  if (!decision) {
    return NextResponse.json({ error: 'decision must be "approve" or "reject".' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) || null : null;

  const actor = {
    userId: session.user.id,
    role: session.user.role ?? null,
    historyLabel: session.user.id ?? session.user.email ?? null,
    trigger: 'review',
  };

  try {
    const grant = await getActorGrant('pattern', patternId, session.user.id);
    const result = await reviewPattern(patternId, decision, actor, { message, grant });
    const row = await getDbPatternById(patternId);
    return NextResponse.json({ ok: true, id: patternId, status: result.status, title: row?.title ?? null });
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    const msg = e instanceof Error ? e.message : 'Could not record the decision.';
    // A stale queue is the common case here, so it reads as a conflict rather than a server fault.
    const stale = /awaiting review|not awaiting|Pattern not found/i.test(msg);
    if (!stale) console.error('[review/:id]', e);
    return NextResponse.json({ error: msg }, { status: stale ? 409 : 500 });
  }
}
