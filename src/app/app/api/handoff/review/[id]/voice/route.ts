import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, type MutateActor } from '@/lib/authz/policy';
import { getDbPatternById, getDesignWorkspaceRow } from '@/lib/db/queries';
import type { PatternComponentEntry } from '@/lib/guest-editable';
import { auditVoice } from '@/lib/server/voice-audit';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Check this build's copy against the brand voice — the `voice` category E.10 shipped deliberately empty.
 *
 * **On demand, and that is the design.** Every other audit is deterministic and free, so it runs on view; this one
 * costs money and about a second, so a reviewer asks for it. Running it on page load would bill every glance at a
 * build, including the ones nobody reviews.
 *
 * **Same authorization as viewing the submission** (`canApprove`): if you may not see a build, you may not spend
 * the workspace's tokens auditing one. Mirrors the review route above it rather than inventing a second rule.
 *
 * Read-only — findings are returned, never stored. A voice judgement is advisory and re-runnable, and persisting it
 * would raise "is this stale?" for no benefit while the copy is still being edited.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  if (!computePermissions(actor, { ownerUserId: null, visibility: 'private' }, null).canApprove) {
    return NextResponse.json({ error: 'Only a maintainer can run this check.' }, { status: 403 });
  }

  const { id } = await params;
  const row = await getDbPatternById((id ?? '').trim());
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const blocks = (Array.isArray(row.components) ? row.components : []) as PatternComponentEntry[];
  const overrides = ((row.data as { previews?: { default?: { values?: unknown[] } } })?.previews?.default?.values ??
    []) as unknown[];
  const workspace = await getDesignWorkspaceRow().catch(() => null);

  try {
    const result = await auditVoice({
      blocks,
      overrides,
      voice: (workspace?.brandVoice as Record<string, string>) ?? {},
      actorUserId: session.user.id,
    });
    /**
     * `ran: false` is not an error — no AI key, no brand voice, or no copy are all legitimate states with nothing to
     * report. The caller shows the reason rather than an empty success that looks like a pass.
     */
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error('[review/voice]', e);
    return NextResponse.json({ error: 'The voice check could not be completed.' }, { status: 502 });
  }
}
