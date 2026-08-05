import 'server-only';
import { cookies } from 'next/headers';
import { getActiveShareLinkById, shareLinkCapabilities, type ShareLinkRow } from '@/lib/db/grant-queries';
import type { GuestPrincipal } from '@/lib/authz/policy';
import { guestCookieName, readGuestSession, type GuestSession } from './guest-session';

/**
 * Turn a guest's signed cookie back into an authorized principal.
 *
 * Every guest-facing route starts here, and the order matters: the cookie proves *which* session this
 * is, then the link row decides *what it may do*. Capabilities are never taken from the cookie, so a
 * revoked link ends its sessions on their next request rather than when the cookie lapses.
 *
 * Returns null for every failure — no cookie, bad signature, expired session, revoked link. Callers turn
 * that into one 401 without distinguishing, because telling a token holder which of those it was tells
 * them something about links they don't hold.
 */
export interface GuestContext {
  link: ShareLinkRow;
  guest: GuestPrincipal;
  session: GuestSession;
  /**
   * The link creator, who owns anything the guest creates. Null only for a link minted by a
   * service/legacy token; `createGuestSubmission` handles that by leaving the row unowned, which is why
   * the guest's claim is `share_link_token` and not ownership.
   */
  ownerUserId: string | null;
}

export async function readGuestContext(linkId: string): Promise<GuestContext | null> {
  const id = linkId.trim();
  if (!id) return null;

  const jar = await cookies();
  const session = readGuestSession(jar.get(guestCookieName(id))?.value, id);
  if (!session) return null;

  const link = await getActiveShareLinkById(id);
  if (!link) return null;

  const guest: GuestPrincipal = {
    shareLinkId: link.token,
    capabilities: shareLinkCapabilities(link),
    name: session.name,
  };
  return { link, guest, session, ownerUserId: link.createdByUserId ?? null };
}

/**
 * The submission this session owns, or null.
 *
 * Read from the **signed cookie**, never from the request body. A body-supplied id would let anyone
 * holding a link name any pattern in the deployment and have the guest write path treat it as theirs —
 * the `share_link_token` check would still catch a foreign page, but only because two independent things
 * both had to be right. Taking it from the cookie means only one does.
 */
export function ownSubmissionId(ctx: GuestContext): string | null {
  return ctx.session.submissionId;
}
