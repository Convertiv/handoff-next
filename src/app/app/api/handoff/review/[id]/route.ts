import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, isAuthorizationError, type MutateActor } from '@/lib/authz/policy';
import { getActorGrant } from '@/lib/db/grant-queries';
import { reviewPattern } from '@/lib/db/pattern-write';
import { getDbPatternById, componentRulesForBlocks } from '@/lib/db/queries';
import { diffSubmissionAgainstTemplate, type PatternComponentEntry } from '@/lib/guest-editable';
import { checkGuardrails, guardrailsFromPatternData } from '@/lib/authoring-guardrails';
import { pageEditedSinceSubmission, readProvenance, templateHasMovedOn } from '@/lib/page-provenance';
import { changeDigest } from '@/lib/change-digest';

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

  /**
   * **The diff compares against what this person was handed, not against the template as it stands now**
   * (reflow §2.1).
   *
   * This is the whole reason the fork copy exists. Templates are live and editable under the reflow, so
   * reading `template.components` here would re-base every past submission the moment the owner touched the
   * template — a reviewer would be shown changes the guest never made, and told the guest made them.
   *
   * Falls back to the live template only when there is no fork copy: a page from the brief era whose
   * migration could not recover one, where the live row is the best available answer and a diff is still
   * better than none.
   */
  const provenance = readProvenance(row.provenance);
  const templateBlocks = (provenance?.blocks?.length
    ? provenance.blocks
    : Array.isArray(template?.components)
      ? template!.components
      : []) as PatternComponentEntry[];
  /** Which of the two the reviewer is actually looking at — never leave them to guess. */
  const comparedAgainst = provenance?.blocks?.length ? 'as-handed' : 'template-now';
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
  // Component-declared limits too, via the same loader the submit gate uses — otherwise a reviewer would see
  // fewer findings than the author was actually held to (roadmap E.9).
  const findings = checkGuardrails(submissionBlocks, values, config, await componentRulesForBlocks(submissionBlocks));

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
    /**
     * The same diff, as a sentence (reflow R.6b).
     *
     * Computed from `blocks` rather than from the content again, so the summary can never disagree with the
     * list beneath it — a digest saying "3 titles" over a list showing four is worse than no digest.
     */
    digest: changeDigest(blocks),
    /**
     * The provenance record, flattened for display (reflow R.4).
     *
     * Sent from here rather than fetched separately because the panel that shows it is the panel that shows the
     * diff, and together they answer one question: what were they handed, and what did they do with it.
     *
     * `blocks` is deliberately **excluded** — it is a whole page's worth of JSON, the diff already carries its
     * effect, and a review payload should not double in size to ship a copy nothing renders.
     */
    provenance: provenance
      ? {
          templateId: provenance.templateId ?? null,
          forkedAt: provenance.forkedAt ?? null,
          submittedAt: provenance.submittedAt ?? null,
          submittedByEmail: provenance.submittedByEmail ?? null,
          legacy: provenance.legacy ?? false,
          /** What the checks said when its author let go of it — a fact about the submission, not a live re-run. */
          findingsAtSubmit: provenance.findings ?? [],
        }
      : null,
    comparedAgainst,
    /** Non-null only where the fork copy survives: when they started, and whether the template has moved since. */
    forkedAt: provenance?.forkedAt ?? null,
    templateHasMovedOn: templateHasMovedOn(provenance, template?.updatedAt ?? null),
    /**
     * Whether this page has moved since it was submitted — true once someone edited it in place (R.4). The diff
     * below includes those changes, and a reviewer reading it as "what the author did" deserves to be told.
     */
    editedSinceSubmission: pageEditedSinceSubmission(provenance, row.updatedAt ?? null),
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
