import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, type MutateActor } from '@/lib/authz/policy';
import { listReviewQueue } from '@/lib/db/grant-queries';

/**
 * The review queue — everything a maintainer needs to work through submitted pages.
 *
 * Gated on `canApprove`, which is admin-only today, so the queue is not merely hidden in the UI: a
 * non-maintainer gets 403 from the endpoint. Permissions are computed against a synthetic resource
 * because `canApprove` doesn't depend on any one row's owner or visibility — reading the queue is a
 * capability, not access to a particular page.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const perms = computePermissions(actor, { ownerUserId: null, visibility: 'private' }, null);
  if (!perms.canApprove) {
    return NextResponse.json({ error: 'Only a maintainer can view the review queue.' }, { status: 403 });
  }

  try {
    const submissions = await listReviewQueue();
    return NextResponse.json({ submissions });
  } catch (e) {
    console.error('[review] queue failed', e);
    return NextResponse.json({ error: 'Could not load the review queue.' }, { status: 500 });
  }
}
