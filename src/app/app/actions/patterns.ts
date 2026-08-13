'use server';

import { auth } from '../../lib/auth';
import {
  applyPatternMeta,
  patchPattern,
  removePattern,
  reviewPattern,
  setTemplateBuilderNotes,
  writePattern,
  type PatternWriteActor,
} from '../../lib/db/pattern-write';
import {
  createShareLink,
  getActorGrant,
  getResourceOwner,
  listShareLinks,
  revokeShareLink,
} from '../../lib/db/grant-queries';
import { computePermissions, toVisibility } from '../../lib/authz/policy';
import { AUTHORING_CAPABILITIES, MAX_PAGES_PER_SHARE_LINK } from '../../lib/authz/vocab';
import { generatePassphrase } from '../../lib/server/passphrase';

async function requireActor(): Promise<PatternWriteActor> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const role = typeof session.user.role === 'string' ? session.user.role : null;
  return { userId, role, historyLabel: session.user.id ?? session.user.email ?? null, trigger: 'ui' };
}

export async function createPattern(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  components?: unknown[];
  payload?: Record<string, unknown>;
  tags?: unknown[];
  source?: string;
  /** `page` | `template` — see `PatternInput.kind`. */
  kind?: string;
  thumbnail?: string | null;
}) {
  const actor = await requireActor();
  await writePattern(
    {
      id: data.id,
      title: data.title,
      description: data.description,
      group: data.group,
      components: data.components,
      data: data.payload,
      tags: data.tags,
      source: data.source,
      kind: data.kind,
      thumbnail: data.thumbnail,
    },
    actor
  );
  return { success: true };
}

export async function updatePattern(
  id: string,
  updates: Partial<{
    title: string;
    description: string;
    group: string;
    components: unknown[];
    data: Record<string, unknown>;
    tags: unknown[];
    source: string;
    thumbnail: string | null;
  }>
) {
  const actor = await requireActor();
  await patchPattern(id, updates, actor);
  return { success: true };
}

export async function deletePattern(id: string) {
  const actor = await requireActor();
  await removePattern(id, actor);
  return { success: true };
}

/**
 * Phase B: set a pattern's sharing visibility and/or lifecycle status.
 *
 * The gate itself lives in the write core (`applyPatternMeta` → `decidePatternMetaChange`) rather than
 * here, so the MCP and HTTP surfaces enforce the same rules instead of each re-deriving them — that
 * duplication is exactly what blocked an MCP status setter. This stays a thin session wrapper: resolve
 * the actor and their grant, then delegate.
 */
export async function setPatternMeta(id: string, meta: { visibility?: string; status?: string; kind?: string }) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', id, actor.userId);
  await applyPatternMeta(id, meta, actor, grant);
  return { success: true };
}

/** Record a reviewer's verdict on a submitted page. Maintainer-gated inside the write core. */
export async function reviewPatternSubmission(
  id: string,
  decision: 'approve' | 'reject',
  message?: string | null
) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', id, actor.userId);
  const result = await reviewPattern(id, decision, actor, { message, grant });
  return { success: true, status: result.status };
}

/**
 * Share a template — the reflow's replacement for `createInvitation` (R.2).
 *
 * **One link, pointed at the template itself, always reflecting it as it is now.** No brief is cut, nothing is
 * versioned, and the owner has nothing to manage: the thing they edit *is* the thing visitors get. The frozen
 * copy that briefs existed to hold is taken per-visitor at fork time and lives on the page each visitor makes
 * (`buildProvenance`), which is where it is actually useful.
 *
 * **`promote` exists so this is one act, not two.** Sharing a page that is not yet a template is the common
 * case — a person decides "others should build from this" and the promotion is implied by the decision. It
 * still goes through `applyPatternMeta`, so the same `canChangeVisibility` gate applies as if they had flipped
 * the control themselves; this is a shortcut through the UI, not around the policy.
 *
 * No `maxUses` by default. The cap that matters is on **pages**, not visits — see `MAX_PAGES_PER_SHARE_LINK`.
 */
export async function shareTemplate(
  templateId: string,
  input: {
    /** Promote the page to a template first. Refused unless the actor could have done it directly. */
    promote?: boolean;
    /** Shown to whoever builds from it. Stored on the template, not on the link. */
    instructions?: string | null;
    /** `GuardrailConfig` — content rules builders are held to. Also on the template. */
    guardrails?: unknown;
    expiresInDays?: number;
    usePassphrase?: boolean;
    label?: string;
  } = {}
) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', templateId, actor.userId);

  if (input.promote) await applyPatternMeta(templateId, { kind: 'template' }, actor, grant);

  /**
   * Instructions and limits are written to the **template**, before the link exists.
   *
   * They used to be arguments to "create an invitation", which is what made them feel like properties of a
   * link — and meant changing them required cutting a new brief. They belong to the thing being shared, so
   * editing them later is just editing the template, and every existing reader already looks there.
   */
  if (input.instructions !== undefined || input.guardrails !== undefined) {
    await setTemplateBuilderNotes(
      templateId,
      { instructions: input.instructions, guardrails: input.guardrails },
      actor
    );
  }

  const days = Number.isFinite(input.expiresInDays) ? Math.max(1, Math.trunc(input.expiresInDays!)) : 14;
  /**
   * **Opt-in, not opt-out** (Brad, 2026-08-13). The link is already a high-entropy secret; a passphrase is the
   * second factor for a link meant for one named person. Defaulting it on made every share a two-secret
   * handover. The default here matches the screen's — a control that says "off" while the server mints one
   * anyway is the kind of disagreement nobody finds until it confuses somebody.
   */
  const passphrase = input.usePassphrase === true ? generatePassphrase() : null;

  const { link, urlToken } = await createShareLink(
    'pattern',
    templateId,
    { userId: actor.userId, role: actor.role ?? null },
    {
      capabilities: [...AUTHORING_CAPABILITIES],
      label: input.label ?? null,
      // Visits are not the cap — see the note above.
      maxUses: null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      passphrase,
    }
  );

  return {
    success: true,
    /** Shown once. Not recoverable afterwards — the UI must say so. */
    urlToken,
    passphrase,
    linkId: link.token,
    expiresAt: link.expiresAt,
    maxPages: MAX_PAGES_PER_SHARE_LINK,
  };
}

/**
 * The live links on a template, and what they have been used for (reflow R.3).
 *
 * Owner-facing, because "who can still get in" is a question an owner has to be able to answer before they can
 * sensibly revoke anything. Returns summaries only — `listShareLinks` never hands back a secret, and the public
 * id is safe to show and to log.
 *
 * Read-through of the same permission the write path uses: only someone who could share this can see who it
 * was shared with.
 */
export async function listTemplateLinks(templateId: string) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', templateId, actor.userId);
  const owner = await getResourceOwner('pattern', templateId);
  const perms = computePermissions(
    { userId: actor.userId, role: actor.role ?? null },
    { ownerUserId: owner?.ownerUserId ?? null, visibility: toVisibility(owner?.visibility) },
    grant
  );
  if (!perms.canChangeVisibility) throw new Error('You do not have permission to see this template’s links.');

  const links = await listShareLinks('pattern', templateId);
  return {
    success: true,
    links: links.map((l) => ({
      id: l.id,
      label: l.label,
      useCount: l.useCount,
      lastUsedAt: l.lastUsedAt ? l.lastUsedAt.toISOString() : null,
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      createdAt: l.createdAt ? l.createdAt.toISOString() : null,
      passphraseRequired: l.passphraseRequired,
      writeCapable: l.writeCapable,
    })),
  };
}

/**
 * Revoke one link.
 *
 * **The control that makes an emailed bearer credential acceptable.** A return link sits in someone's inbox
 * forever and cannot be un-sent; being able to switch it off is what keeps that from being a standing risk.
 * Pages already built are untouched — revoking closes a door, it does not delete what came through it.
 */
export async function revokeTemplateLink(linkId: string) {
  const actor = await requireActor();
  const revoked = await revokeShareLink(linkId, { userId: actor.userId, role: actor.role ?? null });
  return { success: revoked };
}
