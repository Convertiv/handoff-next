import { eq } from 'drizzle-orm';
import { getDb } from './db/index';
import { handoffPatterns, users } from './db/schema';
import { appBaseUrl, sendTemplatedEmail } from './email';
import { readProvenance } from './page-provenance';

/**
 * State-change notifications for invite-to-build — roadmap E.6.
 *
 * **The data was collected for exactly this and then never used.** `handoff_pattern.submitted_by_email` is
 * documented in the schema as *"For a built page: the author's email, for state-change notifications"*, and the
 * guest form collects it with disclosure ("Unverified, collected with disclosure … For notifications only").
 * Meanwhile a build could be submitted and reviewed with nobody told: the owner had to happen to notice a queue
 * badge, and the guest — an outsider with no account and no queue to check — had no way to learn the outcome at
 * all. After submitting, the honest thing the UI could say was "someone will look at this eventually".
 *
 * **Three rules, and the first two are not negotiable:**
 *
 * 1. **A notification must never fail a write.** The submission is the fact; telling someone is a courtesy. Every
 *    call goes through `notifyInBackground`, so a Resend outage cannot fail a build a guest just spent an hour on.
 * 2. **Silence without configuration, not a crash.** `sendTemplatedEmail` skips when `RESEND_API_KEY` is unset —
 *    the behaviour `sendInviteEmail` and `sendPasswordResetEmail` already have — so local and preview environments
 *    need no mail setup.
 * 3. **Link to the exact thing.** E.8 made every level addressable (`/playground/{page}?build={id}`), so the owner
 *    lands on the build itself instead of a dashboard to hunt through. That payoff is the whole reason the level is
 *    in the URL.
 */

/** Where a build is viewed, now that every level is addressable (roadmap E.8). */
function buildUrl(pageId: string, buildId: string): string {
  return `${appBaseUrl()}/playground/${encodeURIComponent(pageId)}?build=${encodeURIComponent(buildId)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A quoted note, only when there is one — an empty blockquote reads as a mistake. */
function noteBlock(note: string | null | undefined): string {
  const trimmed = note?.trim();
  if (!trimmed) return '';
  return `<br/><br/><span style="display:block;padding:8px 12px;border-left:3px solid #e4e4e7;color:#52525b;">${escapeHtml(
    trimmed
  )}</span>`;
}

/**
 * Tell the page owner that a build arrived.
 *
 * The owner is resolved here from the page's `userId` rather than passed in: the caller that knows a submission
 * happened is deep in the write path, and making it carry an address around in order to be allowed to mention the
 * event would spread notification concerns through code that has nothing to do with them.
 */
export async function notifyBuildSubmitted(input: {
  /** The built page — the guest's own copy. Everything else is resolved from it. */
  buildId: string;
  builderName: string | null;
  message: string | null;
}): Promise<void> {
  const db = getDb();
  /**
   * Find the page whose owner should hear about this — **one hop, with a legacy second one** (reflow R.5).
   *
   * ⚠️ This used to be two hops unconditionally: build → brief (`templateId`) → page (`sourcePageId`). Under
   * the reflow a submission's `templateId` is the **template itself**, and a template has no `sourcePageId` —
   * so the second hop found nothing and the function returned early. **Every page built the new way stopped
   * notifying its owner, silently**, from R.2 onwards. Nothing failed; an email simply never arrived.
   *
   * So: prefer the provenance record and fall back to `templateId`. **One hop now** — R.5b dropped
   * `source_page_id`, and with it the only way to walk from a brief to its parent. Every page that could be
   * repointed was; anything still pointing at a brief is an orphan whose parent page no longer exists, so
   * there was never anyone to notify.
   */
  const [build] = await db
    .select({ templateId: handoffPatterns.templateId, provenance: handoffPatterns.provenance })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, input.buildId))
    .limit(1);

  const fromProvenance = readProvenance(build?.provenance)?.templateId ?? null;
  const firstHop = fromProvenance ?? build?.templateId ?? null;
  if (!firstHop) return;

  const [target] = await db
    .select({ kind: handoffPatterns.kind })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, firstHop))
    .limit(1);
  if (!target) return;
  // An orphaned legacy row still pointing at a brief has no owner to reach — its parent page is gone.
  if (target.kind === 'brief') return;
  const pageId = firstHop;

  const [page] = await db
    .select({ ownerId: handoffPatterns.userId, title: handoffPatterns.title })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, pageId))
    .limit(1);
  if (!page?.ownerId) return;

  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, page.ownerId)).limit(1);
  if (!owner?.email) return;

  const who = input.builderName?.trim() || 'Someone';
  const title = page.title || 'your page';

  await sendTemplatedEmail({
    kind: 'build-submitted',
    to: owner.email,
    subject: `${who} submitted a build of “${title}”`,
    title: 'A build is ready for review',
    body: `<strong>${escapeHtml(who)}</strong> submitted a build of “${escapeHtml(
      title
    )}”.${noteBlock(input.message)}`,
    ctaLabel: 'Review the build',
    ctaUrl: buildUrl(pageId, input.buildId),
    footnote: 'You received this because you own the page this build was made from.',
  });
}

/**
 * Tell the person who built it what was decided.
 *
 * The notification that matters most, and the one hardest to live without: a guest has no account and nothing to
 * check, so the outcome was previously unknowable to them.
 *
 * **No call to action, deliberately.** A guest cannot open the workbench, so a button would be a dead end dressed
 * as an action. The decision and the reviewer's note are the entire payload.
 *
 * The address is unverified by nature — collected in the guest form with disclosure — so this is best effort: no
 * address means no email and no error.
 */
export async function notifyBuildDecision(input: {
  buildId: string;
  /** The lifecycle status the review moved it to. */
  status: string;
  note: string | null;
}): Promise<void> {
  const db = getDb();
  const [build] = await db
    .select({ email: handoffPatterns.submittedByEmail, title: handoffPatterns.title })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, input.buildId))
    .limit(1);
  if (!build?.email) return;

  const approved = input.status === 'approved';
  const title = build.title || 'your page';

  await sendTemplatedEmail({
    kind: 'build-decision',
    to: build.email,
    subject: approved ? `“${title}” was approved` : `“${title}” needs another look`,
    title: approved ? 'Your page was approved' : 'Your page needs another look',
    body: approved
      ? `“${escapeHtml(title)}” has been approved. Thank you for putting it together.${noteBlock(input.note)}`
      : `“${escapeHtml(title)}” was reviewed and needs another look.${noteBlock(input.note)}`,
    footnote: 'You received this because you submitted this page.',
  });
}

/**
 * Send an anonymous author the link back to the page they just made (reflow R.3).
 *
 * ⚠️ **This email contains a bearer credential.** Whoever holds the URL can edit that page, so:
 *
 * - it goes only to the address given in that session, never to a list, never to the owner;
 * - the link is scoped to **one page** and grants `view` + `edit_own_submission` and nothing else;
 * - it says plainly what the link does, because a recipient who does not know it is a key cannot be careful
 *   with it, and forwarding a thread is the normal way these leak;
 * - and it is revocable by the owner at any time, which is the point of saying so here.
 *
 * The address is unverified by nature — typed into a guest form — so this is best effort. The completion
 * screen shows the same link, so a message that never arrives is an inconvenience rather than a lost page.
 */
export async function notifyReturnLink(input: {
  pageId: string;
  pageTitle: string | null;
  to: string;
  /** The secret half of the link. Never logged, never stored — only its hash exists server-side. */
  urlToken: string;
}): Promise<void> {
  const title = input.pageTitle?.trim() || 'your page';
  await sendTemplatedEmail({
    kind: 'return-link',
    to: input.to,
    subject: `Your link to “${title}”`,
    title: 'Your page is saved',
    body:
      `“${escapeHtml(title)}” has been sent for review, and you can come back to it any time with the link ` +
      `below.<br><br><strong>Keep this link private — anyone who has it can edit your page.</strong>`,
    ctaLabel: 'Open your page',
    ctaUrl: `${appBaseUrl()}/s/${encodeURIComponent(input.urlToken)}`,
    footnote: 'You received this because you built this page. The person who shared the template can revoke this link.',
  });
}

/**
 * Fire a notification without letting it affect the caller — rule 1 above.
 *
 * Swallows **and logs**: a delivery failure is an operational detail, not something to show the person who just
 * submitted a build, and certainly not a reason to undo their write.
 */
export function notifyInBackground(what: string, run: () => Promise<void>): void {
  void run().catch((e: unknown) => {
    console.error(`[notify] ${what} failed`, e);
  });
}
