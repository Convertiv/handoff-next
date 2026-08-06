import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { getResourceOwner } from '@/lib/db/grant-queries';
import { listTemplateSubmissions } from '@/lib/db/queries';

/**
 * The pages built from one template — its submissions.
 *
 * A guest submission's relationship is to the template it came from, not to the library at large, so this is
 * how a template surfaces its own children instead of them floating beside their owner's work.
 *
 * Gated on `canView` of the template. Deliberately not on `canApprove`: whoever owns the template should see
 * what came back from it even if approving is someone else's job.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const templateId = (id ?? '').trim();
  if (!templateId) return NextResponse.json({ error: 'A template id is required.' }, { status: 400 });

  const owner = await getResourceOwner('pattern', templateId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const perms = computePermissions(
    actor,
    { ownerUserId: owner.ownerUserId, visibility: toVisibility(owner.visibility) },
    null
  );
  if (!perms.canView) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    return NextResponse.json({ submissions: await listTemplateSubmissions(templateId) });
  } catch (e) {
    console.error('[templates/:id/submissions]', e);
    return NextResponse.json({ error: 'Could not load submissions.' }, { status: 500 });
  }
}
