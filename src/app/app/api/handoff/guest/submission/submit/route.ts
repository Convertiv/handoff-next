import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizationError } from '@/lib/authz/policy';
import { isGuardrailBlockedError } from '@/lib/authoring-guardrails';
import { submitGuestSubmission } from '@/lib/db/pattern-write';
import { readGuestContext } from '@/lib/server/guest-context';

/**
 * Hand the guest's draft to the reviewers: `draft` → `review`, and nothing else.
 *
 * Separate route from the editing one because it is the state transition, not an edit — it is the point
 * the guest loses write access (`canGuestEditPattern` requires `draft`), and that deserves its own
 * endpoint rather than a magic field in a PATCH body.
 *
 * Visibility is untouched. Submitting asks for attention; granting access is the reviewer's call.
 */
export async function POST(request: NextRequest) {
  const linkId = request.nextUrl.searchParams.get('link')?.trim() ?? '';
  const ctx = linkId ? await readGuestContext(linkId) : null;
  if (!ctx) {
    return NextResponse.json({ error: 'This session is no longer valid. Open the link again.' }, { status: 401 });
  }

  const id = ctx.session.submissionId;
  if (!id) return NextResponse.json({ error: 'There is no page to submit yet.' }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { message?: unknown };
  // The guest's note to the reviewer, recorded as the change's "why" alongside their name.
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) || null : null;

  try {
    await submitGuestSubmission(id, ctx.guest, message);
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    /**
     * Blocking findings are an *answer*, not a failure: the request was well-formed and the content did not pass,
     * so 422 with the findings attached rather than a 500 with a shrug. The build view renders these per block and
     * per field; before this the guest saw "Could not submit the page." and the reason lived in a Vercel log.
     */
    if (isGuardrailBlockedError(e)) {
      return NextResponse.json({ error: e.message, findings: e.findings }, { status: 422 });
    }
    console.error('[guest/submission/submit]', e);
    return NextResponse.json({ error: 'Could not submit the page.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, status: 'review' });
}
