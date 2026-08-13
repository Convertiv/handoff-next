'use server';

import { auth } from '../../lib/auth';
import {
  applyPatternMeta,
  patchPattern,
  removePattern,
  reviewPattern,
  savePageAsTemplate,
  updateBriefInstructions,
  writePattern,
  type PatternWriteActor,
} from '../../lib/db/pattern-write';
import { createShareLink, getActorGrant, listShareLinks, revokeShareLink } from '../../lib/db/grant-queries';
import { AUTHORING_CAPABILITIES } from '../../lib/authz/vocab';
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
 * Save a page as a template — a separate, frozen, team-visible copy (roadmap E.2).
 *
 * The page is untouched: the author keeps iterating on theirs while the template becomes the standard
 * others clone from and guests build from.
 */
export async function savePatternAsTemplate(pageId: string, title?: string) {
  const actor = await requireActor();
  const template = await savePageAsTemplate(pageId, actor, { title });
  return { success: true, ...template };
}

/**
 * Create an invitation: a **brief** (frozen snapshot of the page + its instructions and guardrails) and the
 * first **invite link** for it. One action because the wizard's last step is one decision — you never want a
 * brief with no way in, or a link with nothing behind it.
 *
 * The passphrase is generated here rather than accepted from the client: a client-chosen one would be reused
 * across invitations and typed into the same box people paste links into. It is returned **once** — only its
 * scrypt hash is stored (see `docs/INVITE-TO-BUILD.md`).
 */
export async function createInvitation(
  pageId: string,
  input: {
    title?: string;
    description?: string;
    instructions?: string;
    guardrails?: unknown;
    expiresInDays?: number;
    maxUses?: number | null;
    usePassphrase?: boolean;
    label?: string;
  }
) {
  const actor = await requireActor();

  const brief = await savePageAsTemplate(pageId, actor, {
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    guardrails: input.guardrails,
  });

  const days = Number.isFinite(input.expiresInDays) ? Math.max(1, Math.trunc(input.expiresInDays!)) : 14;
  const passphrase = input.usePassphrase === false ? null : generatePassphrase();

  const { link, urlToken } = await createShareLink(
    'pattern',
    brief.id,
    { userId: actor.userId, role: actor.role ?? null },
    {
      capabilities: [...AUTHORING_CAPABILITIES],
      label: input.label ?? null,
      maxUses: input.maxUses ?? null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      passphrase,
    }
  );

  return {
    success: true,
    brief: { id: brief.id, title: brief.title, version: brief.version },
    /** Shown once. Not recoverable afterwards — the UI must say so. */
    urlToken,
    passphrase,
    linkId: link.token,
    expiresAt: link.expiresAt,
  };
}

/**
 * Revoke every active write-capable link on a brief.
 *
 * Only the *write-capable* ones: a brief can also carry a read-only viewer link, and "stop people building
 * from this" should not quietly stop people looking at it. Returns how many were revoked so the caller can
 * tell "deactivated" from "there was nothing active".
 */
async function revokeInviteLinks(briefId: string, actor: PatternWriteActor): Promise<number> {
  const links = await listShareLinks('pattern', briefId);
  const mutateActor = { userId: actor.userId, role: actor.role ?? null };
  let revoked = 0;
  for (const link of links) {
    if (!link.writeCapable) continue;
    // `listShareLinks` already filters to active links, so each of these is a real state change.
    if (await revokeShareLink(link.id, mutateActor)) revoked += 1;
  }
  return revoked;
}

/**
 * Replace a brief's invitation with a fresh link and passphrase (roadmap E.8b).
 *
 * This exists because neither secret is recoverable — a write-capable token is SHA-256 hashed and a passphrase
 * is scrypt-hashed, so there is no "show it again". Regenerating is the honest version of that: the old link
 * stops working, a new one is minted, and it is returned **once**.
 *
 * The old links are revoked *first*. If minting then failed we would rather leave the brief with no working
 * invitation than with the old one still live after the user was told it was replaced.
 */
export async function regenerateInvite(
  briefId: string,
  input: { expiresInDays?: number; maxUses?: number | null; usePassphrase?: boolean } = {}
) {
  const actor = await requireActor();
  const revoked = await revokeInviteLinks(briefId, actor);

  const days = Number.isFinite(input.expiresInDays) ? Math.max(1, Math.trunc(input.expiresInDays!)) : 14;
  const passphrase = input.usePassphrase === false ? null : generatePassphrase();

  const { link, urlToken } = await createShareLink(
    'pattern',
    briefId,
    { userId: actor.userId, role: actor.role ?? null },
    {
      capabilities: [...AUTHORING_CAPABILITIES],
      maxUses: input.maxUses ?? null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      passphrase,
    }
  );

  return {
    success: true,
    revoked,
    /** Shown once. Not recoverable afterwards — the UI must say so. */
    urlToken,
    passphrase,
    linkId: link.token,
    expiresAt: link.expiresAt,
  };
}

/**
 * Stop new builds without destroying the record of what was sent (roadmap E.8b).
 *
 * Deliberately **not** the same as archiving the brief: archiving hides the brief and its builds
 * (`removePattern`), while this leaves everything visible and reviewable and only closes the door. They are
 * different decisions and the panel offers them as different buttons.
 */
export async function deactivateInvite(briefId: string) {
  const actor = await requireActor();
  return { success: true, revoked: await revokeInviteLinks(briefId, actor) };
}

/** Edit the instructions on a frozen brief — see `updateBriefInstructions` for why this is not `patchPattern`. */
export async function editBriefInstructions(briefId: string, instructions: string) {
  const actor = await requireActor();
  await updateBriefInstructions(briefId, instructions, actor);
  return { success: true };
}
