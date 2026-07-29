import type { ComponentSpec } from '../server/design-spec-types';

/**
 * Applying a natural-language tweak to a specification.
 *
 * This is the hole in the middle of the chain. Today a tweak either re-rolls the whole image or edits
 * pixels; nothing edits the *specification*. Until it does, the spec is an output rather than a source
 * of truth, and "what changed and why" has no durable answer.
 *
 * The pure parts live here — prompt construction, response validation, and the merge — so the
 * mechanism is testable without a model. The model call itself lives in
 * `lib/server/spec-patcher.ts`.
 *
 * **Routing is the real problem, not editing.** "Shorten the headline" is a spec change. "Make it feel
 * more premium" is art direction the spec cannot hold. "Give the CTA more room" is genuinely ambiguous
 * — it could be a spacing token or a compositional judgement. A patcher that guesses silently on the
 * third case is worse than one that asks, so `target` is a first-class part of the response and
 * `unsure` is a legitimate answer.
 */

/** Which artefact a request belongs to. */
export type PatchTarget = 'spec' | 'art-direction' | 'unsure';

/** Sections the patcher is allowed to rewrite. Anything else is derived or generated, not authored. */
export const PATCHABLE_SECTIONS = ['overview', 'variants', 'props', 'content', 'behavior', 'accessibility', 'implementation', 'assetRequirements'] as const;
export type PatchableSection = (typeof PATCHABLE_SECTIONS)[number];

/**
 * Sections the patcher must NOT touch, and why.
 *
 * `tokens`, `reuse` and `voice` are *findings* — measured against the registry's real tokens, its real
 * component catalog, and the brand-voice guidance. Letting a tweak rewrite them would let the user
 * edit their own report card: you could "fix" a token-coverage score without changing the design.
 * They are recomputed by regeneration, never authored.
 */
export const DERIVED_SECTIONS = ['tokens', 'reuse', 'voice'] as const;

export interface SpecPatchResponse {
  target: PatchTarget;
  /** Why this target — shown to the user when `unsure`, so they can decide rather than be guessed at. */
  reasoning: string;
  /** The sections the patch touches. Empty when target isn't `spec`. */
  sections: PatchableSection[];
  /** Partial spec containing ONLY the changed sections. */
  patch: Partial<ComponentSpec>;
  /** One-line description of the change, suitable as a version's changeReason. */
  changeSummary: string;
  /** Set when the request cannot be satisfied by editing the spec — e.g. pure art direction. */
  cannotApply?: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

/**
 * The spec is sent whole so the model can see what it's editing, but with derived sections stripped —
 * they're large, they're not editable, and including them invites the model to "helpfully" rewrite a
 * score.
 */
export function specForPatching(spec: ComponentSpec): Partial<ComponentSpec> {
  const out: Record<string, unknown> = {};
  for (const key of PATCHABLE_SECTIONS) {
    const v = (spec as unknown as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out as Partial<ComponentSpec>;
}

export function buildPatchPrompt(params: { spec: ComponentSpec; request: string; brandVoice?: string }): string {
  const { spec, request, brandVoice } = params;
  const editable = JSON.stringify(specForPatching(spec), null, 2);

  return `You apply a requested change to a UI component's specification.

## The current specification (editable sections only)
${editable}

## The requested change
${request}
${brandVoice ? `\n## Brand voice guidelines — any copy you write must obey these\n${brandVoice.slice(0, 4000)}` : ''}

## First, decide what the request is actually about

- **spec** — it changes content, structure, props, behaviour, accessibility, or the imagery required.
  Examples: "shorten the headline", "add a phone field", "make the CTA say Book a demo",
  "the photo should be portrait".
- **art-direction** — it is about composition, proportion, mood, or feel: qualities a specification
  cannot express and which belong to the visual, not the contract.
  Examples: "make it feel more premium", "give it more air", "less corporate".
- **unsure** — it could reasonably be either, and choosing wrongly would do the wrong thing.
  Example: "give the CTA more room" — that might be a spacing change or a compositional one.

Choosing "unsure" is CORRECT when the request is genuinely ambiguous. Do not guess to seem decisive;
a wrong silent edit is worse than a question.

## Then return ONLY this JSON

{
  "target": "<spec|art-direction|unsure>",
  "reasoning": "<one or two sentences on why — for 'unsure', state the two readings plainly>",
  "sections": ["<only the sections your patch changes>"],
  "patch": { "<section>": <the COMPLETE new value for that section> },
  "changeSummary": "<one line describing the change, past tense, e.g. 'Shortened the hero headline to 6 words'>",
  "cannotApply": "<omit unless target is not 'spec'; explain what would need to happen instead>"
}

Rules:
- Only these sections may appear in "patch": ${PATCHABLE_SECTIONS.join(', ')}.
- NEVER include ${DERIVED_SECTIONS.join(', ')}. Those are measurements against the design system and
  the brand guidance, not authored content — they are recomputed, and editing them would falsify a
  report rather than change a design.
- Each section in "patch" must be the COMPLETE replacement value for that section, not a fragment.
  A partial "content" object would silently delete the rest of it.
- Change the MINIMUM necessary. Do not reword copy you were not asked to touch, do not reorder
  entries, and do not "improve" things opportunistically — every unrequested edit shows up as a
  change the user has to review.
- When target is "art-direction" or "unsure", return an empty "patch" and empty "sections", and
  explain in "cannotApply" / "reasoning".
- Return ONLY valid JSON — no markdown, no commentary.`;
}

// ── Validation + merge ────────────────────────────────────────────────────────

const PATCHABLE = new Set<string>(PATCHABLE_SECTIONS);
const DERIVED = new Set<string>(DERIVED_SECTIONS);

export interface ParsedPatch {
  ok: boolean;
  error?: string;
  response?: SpecPatchResponse;
  /** Sections the model tried to change but isn't allowed to — reported, not silently dropped. */
  rejectedSections?: string[];
}

/**
 * Parse and validate a patch response.
 *
 * Rejections are surfaced rather than quietly ignored: if a model tries to rewrite `tokens`, the user
 * should know its patch was constrained, because otherwise a change they *think* they made simply
 * doesn't happen.
 */
export function parsePatchResponse(raw: string): ParsedPatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());
  } catch {
    return { ok: false, error: 'The patch response was not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'The patch response was not an object.' };

  const o = parsed as Record<string, unknown>;
  const target = o.target;
  if (target !== 'spec' && target !== 'art-direction' && target !== 'unsure') {
    return { ok: false, error: `Unknown target "${String(target)}".` };
  }

  const rawPatch = o.patch && typeof o.patch === 'object' && !Array.isArray(o.patch) ? (o.patch as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  const rejectedSections: string[] = [];
  for (const [k, v] of Object.entries(rawPatch)) {
    if (PATCHABLE.has(k)) patch[k] = v;
    else rejectedSections.push(k + (DERIVED.has(k) ? ' (derived — recomputed, not authored)' : ' (unknown section)'));
  }

  const response: SpecPatchResponse = {
    target,
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : '',
    sections: Object.keys(patch) as PatchableSection[],
    patch: patch as Partial<ComponentSpec>,
    changeSummary: typeof o.changeSummary === 'string' && o.changeSummary.trim() ? o.changeSummary.trim() : 'Applied a requested change.',
    cannotApply: typeof o.cannotApply === 'string' && o.cannotApply.trim() ? o.cannotApply.trim() : undefined,
  };

  if (target === 'spec' && response.sections.length === 0) {
    return {
      ok: false,
      error: 'The model reported a spec change but returned no editable sections.',
      response,
      rejectedSections: rejectedSections.length ? rejectedSections : undefined,
    };
  }

  return { ok: true, response, rejectedSections: rejectedSections.length ? rejectedSections : undefined };
}

/**
 * Merge a validated patch onto a spec.
 *
 * Section-level replacement, deliberately. A deep merge would make it impossible to *remove* an entry
 * — dropping a form field would silently keep it — and "the complete new value for the section" is a
 * rule the model can actually follow, unlike inferring merge semantics.
 *
 * Returns a new object; the input is never mutated, so the caller still holds the previous version for
 * diffing.
 */
export function applySpecPatch(spec: ComponentSpec, patch: Partial<ComponentSpec>): ComponentSpec {
  const next = { ...(spec as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (!PATCHABLE.has(k) || v === undefined) continue;
    next[k] = v;
  }
  // The spec was edited, so its generation timestamp no longer describes it.
  next.generatedAt = new Date().toISOString();
  return next as unknown as ComponentSpec;
}
