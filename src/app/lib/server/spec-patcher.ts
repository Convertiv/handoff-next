import 'server-only';

import { getDesignArtifactById, updateDesignArtifactById } from '@/lib/db/queries';
import { openAiChatJson } from '@/lib/server/ai-client';
import { formatBrandVoiceForPrompt, getDesignWorkspace } from '@/lib/server/design-workspace';
import { specToMarkdown } from '@/lib/server/design-spec-generator';
import { applySpecPatch, buildPatchPrompt, parsePatchResponse, type PatchTarget } from '@/lib/spec/patch';
import { diffSpecs, type SpecDiff } from '@/lib/spec/diff';
import { recordSpecVersion } from '@/lib/spec/versioning';
import type { ComponentSpec } from '@/lib/server/design-spec-types';

/**
 * Apply a natural-language tweak to an artifact's specification.
 *
 * This is what makes the specification a source of truth rather than an output: a request like
 * "shorten the headline" edits the spec, gets a reviewable diff, and lands as a new version with the
 * reason attached — instead of re-rolling an image and hoping.
 *
 * Three things it deliberately does NOT do:
 *
 *  1. **It doesn't guess on ambiguity.** A request that could be either a spec change or an
 *     art-direction change comes back as `unsure` with both readings, for the user to settle. Silently
 *     picking one produces edits nobody asked for.
 *  2. **It doesn't let a tweak edit its own measurements.** `tokens`, `reuse` and `voice` are findings
 *     computed against the real design system; they're stripped from the prompt and ignored on the way
 *     back, so you can't "improve" a coverage score without changing the design.
 *  3. **It doesn't regenerate the image.** The spec and the visual are now separate artefacts, and
 *     re-rendering is a distinct, explicit step.
 */

const PATCH_MODEL = () => process.env.HANDOFF_SPEC_MODEL?.trim() || process.env.HANDOFF_AI_MODEL?.trim() || 'gpt-4.1';

export interface PatchSpecResult {
  ok: boolean;
  target?: PatchTarget;
  /** Why the patcher classified the request this way — the message to show on `unsure`. */
  reasoning?: string;
  /** Present when a spec change was applied. */
  applied?: {
    sections: string[];
    changeSummary: string;
    diff: SpecDiff;
    version: number | null;
  };
  /** Present when the request wasn't a spec change, explaining what would be needed instead. */
  cannotApply?: string;
  /** Sections the model tried to change but isn't allowed to — surfaced, never silently dropped. */
  rejectedSections?: string[];
  error?: string;
}

export async function patchSpecFromRequest(args: {
  artifactId: string;
  request: string;
  actorUserId?: string | null;
}): Promise<PatchSpecResult> {
  const request = args.request.trim();
  if (!request) return { ok: false, error: 'Describe the change you want.' };
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return { ok: false, error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' };
  }

  const row = await getDesignArtifactById(args.artifactId);
  if (!row) return { ok: false, error: 'Design not found' };
  const current = (row.componentSpec ?? null) as ComponentSpec | null;
  if (!current) {
    return { ok: false, error: 'This design has no specification yet — run the dev handoff first.' };
  }

  // Any copy the patcher writes must obey the brand voice, or a tweak becomes a way to smuggle
  // off-brand text past the checks that the voice section applies.
  const workspace = await getDesignWorkspace().catch(() => null);
  const brandVoice = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';

  let raw: string;
  try {
    raw = await openAiChatJson(
      [
        { role: 'system', content: buildPatchPrompt({ spec: current, request, brandVoice }) },
        { role: 'user', content: 'Return the patch JSON.' },
      ],
      {
        actorUserId: args.actorUserId ?? row.userId,
        route: 'spec-patch',
        eventType: 'ai.spec_patch',
        model: PATCH_MODEL(),
        maxTokens: 4000,
      }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The patch request failed.' };
  }

  const parsed = parsePatchResponse(raw);
  if (!parsed.ok || !parsed.response) {
    return { ok: false, error: parsed.error ?? 'The patch response could not be used.', rejectedSections: parsed.rejectedSections };
  }
  const res = parsed.response;

  // Not a spec change — report it rather than forcing an edit that would misrepresent the request.
  if (res.target !== 'spec') {
    return {
      ok: true,
      target: res.target,
      reasoning: res.reasoning,
      cannotApply:
        res.cannotApply ??
        (res.target === 'art-direction'
          ? 'This is an art-direction change: it affects composition or feel, which the specification does not hold. Adjust it on the design itself.'
          : 'This could be either a specification change or an art-direction change — say which you meant.'),
      rejectedSections: parsed.rejectedSections,
    };
  }

  const next = applySpecPatch(current, res.patch);
  const diff = diffSpecs(current, next);

  // A patch that changes nothing is worth saying out loud: it usually means the request was already
  // satisfied, or the model misread it. Recording an empty version would just pollute the history.
  if (diff.unchanged) {
    return {
      ok: true,
      target: 'spec',
      reasoning: res.reasoning,
      cannotApply: 'That change would leave the specification identical — nothing to apply.',
      rejectedSections: parsed.rejectedSections,
    };
  }

  const specMd = specToMarkdown(next);
  await updateDesignArtifactById(args.artifactId, {
    componentSpec: next as unknown as Parameters<typeof updateDesignArtifactById>[1]['componentSpec'],
    componentSpecMd: specMd,
  } as Parameters<typeof updateDesignArtifactById>[1]);

  // The user's own words become the version's reason, which is the point of versioning at all.
  const version = await recordSpecVersion({
    artifactId: args.artifactId,
    spec: next,
    specMd,
    source: 'edited',
    changeReason: `${res.changeSummary} — requested: "${request}"`,
    createdByUserId: args.actorUserId ?? row.userId,
  });

  return {
    ok: true,
    target: 'spec',
    reasoning: res.reasoning,
    applied: { sections: res.sections, changeSummary: res.changeSummary, diff, version: version.version },
    rejectedSections: parsed.rejectedSections,
  };
}
