import type { ComponentSpec } from '../server/design-spec-types';

/**
 * Writing a specification from a brief, before any image exists.
 *
 * The existing spec generator reads a composite screenshot: it transcribes visible text and observes
 * colours. That makes the image the source and the spec a report of it — which forces the whole chain
 * to run backwards. Assets can only be generated from a spec, the spec can only be written from an
 * image, so the image must come first, and the "assets" it declares are then regenerated from a
 * one-line description of a photo that already exists. They never match, and they can't: the asset
 * generator has never seen the design.
 *
 * This is the other direction. A brief becomes a specification, the specification declares its imagery,
 * the imagery is generated, and the composite is assembled from it. The image becomes a *rendering of
 * the spec* rather than its origin, which is what makes revising the spec re-render instead of re-roll.
 *
 * Two consequences the prompt has to take seriously:
 *
 *  1. **The model authors the copy** rather than transcribing it, so brand voice is an input here, not
 *     just a check applied afterwards.
 *  2. **`assetRequirements.subject` IS the image-generation prompt.** In the image-first flow it was a
 *     description of something that already existed and nothing depended on its richness. Here it is
 *     the only thing the asset generator will ever see — a terse subject produces a generic stock
 *     photo, which is precisely the failure this direction is meant to remove.
 *
 * Pure and dependency-free so the prompt's rules are unit-testable.
 */

export interface BriefSpecInput {
  /** What the user asked for, in their words. */
  brief: string;
  /** Copy strings the user supplied verbatim — these must survive into the spec unchanged. */
  copyFromPrompt: string[];
  /** Formatted token summary, so the spec can name real tokens instead of inventing values. */
  tokenSummary?: string;
  /** Brand voice guidance — load-bearing, because the model is writing the copy. */
  brandVoice?: string;
  /** Team design guidelines. */
  designMd?: string;
  /** Existing component schemas to compose against. */
  existingComponents?: { id: string; title: string; propsJson: string }[];
}

export function buildBriefSpecPrompt(input: BriefSpecInput): string {
  const { brief, copyFromPrompt, tokenSummary, brandVoice, designMd, existingComponents } = input;

  const copySection = copyFromPrompt.length
    ? `\n\n## Copy the user supplied — use these strings VERBATIM, do not rewrite them\n${copyFromPrompt.map((s) => `- "${s}"`).join('\n')}`
    : '';

  const voiceSection = brandVoice?.trim()
    ? `\n\n## Brand voice — you are WRITING copy, so this governs every string you author\n${brandVoice.slice(0, 4000)}`
    : '';

  const tokenSection = tokenSummary?.trim()
    ? `\n\n## The design system's real tokens — name these, never invent values\n${tokenSummary.slice(0, 6000)}`
    : '';

  const guidelinesSection = designMd?.trim() ? `\n\n## Team design guidelines\n${designMd.slice(0, 2000)}` : '';

  const existingSection = existingComponents?.length
    ? `\n\n## Existing components to compose from\n${existingComponents.map((c) => `### ${c.title} (id: ${c.id})\n${c.propsJson}`).join('\n\n')}`
    : '';

  return `You are writing a component specification from a design brief. No design exists yet — this
specification is what the design will be generated FROM, so it must be complete enough to build from
on its own.

## The brief
${brief}${copySection}${voiceSection}${tokenSection}${guidelinesSection}${existingSection}

## Instructions
Return a ComponentSpec JSON object matching this EXACT schema:

{
  "version": 1,
  "generatedAt": "<ISO timestamp>",
  "overview": {
    "name": "<PascalCase component name>",
    "description": "<1-2 sentence description>",
    "type": "<atom|molecule|organism|template|pattern|other>",
    "designSystemGroup": "<group name e.g. Inputs, Navigation, Feedback>",
    "summary": "<2-3 sentence design and purpose summary>"
  },
  "variants": [
    { "key": "<default or a state key>", "name": "<display name>", "description": "<what differs>", "isDefault": true|false }
  ],
  "props": [
    { "name": "<propName>", "type": "<string|boolean|enum|number|ReactNode|function>", "required": true|false, "defaultValue": "<if any>", "options": ["<for enum>"], "description": "<purpose>" }
  ],
  "behavior": {
    "interactions": [{ "trigger": "<click|hover|focus|keydown|change>", "action": "<what happens>" }],
    "transitions": ["<animation note>"],
    "edgeCases": ["<empty state, overflow, loading, etc.>"]
  },
  "accessibility": {
    "ariaRole": "<role>",
    "requiredAriaAttributes": ["<aria-label>"],
    "keyboardNav": [{ "key": "<Tab|Enter|Space|Arrow>", "action": "<what happens>" }],
    "screenReaderNotes": "<what a screen reader user experiences>",
    "wcagTarget": "AA"
  },
  "content": {
    "textInventory": [
      { "text": "<the copy you are writing>", "role": "<heading|label|button|body|placeholder|error|badge|helper|link>", "location": "<where in the component>", "editable": true|false }
    ],
    "copyFromPrompt": ${JSON.stringify(copyFromPrompt)},
    "rules": ["<content rule, e.g. headline max 8 words>"]
  },
  "implementation": {
    "existingComponentMatches": [],
    "dependencies": ["<other component ids this depends on>"],
    "cssNotes": "<LAYOUT and STRUCTURE only — grid/columns, stacking, alignment, responsive behaviour>",
    "developerHints": ["<hint>"]
  },
  "assetRequirements": [
    { "slot": "<the prop this image fills, e.g. backgroundImage>", "kind": "<photo|illustration>", "subject": "<the full image brief — see the rules below>", "aspect": "<1:1|3:2|2:3|16:9>", "minWidth": <intrinsic width in CSS px the slot needs at 1x>, "focalPoint": "<where the subject sits, e.g. center-right>", "formats": ["<jpeg|webp|png>"] }
  ]
}

Rules:
- You are AUTHORING this component, not describing one. Write the actual copy — real headlines, real
  button labels — not placeholders like "Headline goes here". Every string you write must obey the
  brand voice above. Any copy the user supplied verbatim must appear exactly as given.
- content.textInventory must contain every string the design will display.
- assetRequirements: declare ONLY genuine photographic or illustrative content — imagery a person would
  have to shoot, source or commission. Flat colours and gradients are TOKENS. Icons come from the icon
  library. Buttons, cards and panels are components. Most components need NO imagery; return an empty
  array when that is the case rather than inventing a decorative photo.
- **assetRequirements.subject becomes the image-generation prompt verbatim, and it is the only thing
  the image model will see.** Write a complete art direction brief in it: subject, setting, lighting,
  mood, colour direction, depth of field, and how the frame is composed. Two or three sentences.
  A subject like "a team collaborating" produces generic stock imagery; describe the specific picture
  you intend. Never mention layout, overlaid text, buttons or surrounding UI — anything structural in
  it produces a screenshot of a component instead of a usable photograph.
- assetRequirements.aspect/minWidth: choose from the slot's role — a right-hand hero photo, a full-bleed
  banner and a square avatar need different ratios.
- cssNotes and developerHints: LAYOUT and STRUCTURE only. Do NOT state hex colours, font sizes, spacing
  values or radii. Name the intent ("primary action colour", "card corner radius") and let the design
  system's tokens supply the value.
- Do NOT emit "tokens", "reuse" or "voice" sections. Those are measured separately against the real
  design system; anything you write there would be a guess presented as a finding.
- Return ONLY valid JSON — no markdown, no commentary.`;
}

/**
 * Sections a brief-written spec must never contain.
 *
 * Same reasoning as the patcher: these are measurements against the registry, and a spec authored
 * before anything has been rendered has nothing to measure. Emitting them would report a conformance
 * score for a design that does not exist yet.
 */
export const BRIEF_FORBIDDEN_SECTIONS = ['tokens', 'reuse', 'voice'] as const;

/** Strip any measurement sections a brief spec came back with. */
export function stripMeasuredSections(spec: ComponentSpec): ComponentSpec {
  const out = { ...(spec as unknown as Record<string, unknown>) };
  for (const k of BRIEF_FORBIDDEN_SECTIONS) delete out[k];
  return out as unknown as ComponentSpec;
}

/**
 * Whether a brief spec is usable as the input to generation.
 *
 * Checked because the failure is silent otherwise: a spec with no content produces a composite with no
 * content, and the run looks successful right up until someone looks at the image.
 */
export function briefSpecProblems(spec: ComponentSpec | null): string[] {
  if (!spec) return ['The model returned a specification that could not be parsed.'];
  const problems: string[] = [];
  if (!spec.overview?.name?.trim()) problems.push('No component name.');
  if (!spec.content?.textInventory?.length) problems.push('No content — the specification declares nothing to display.');

  for (const req of spec.assetRequirements ?? []) {
    if (!req.slot?.trim()) problems.push('An asset requirement has no slot.');
    // The subject is the generation prompt. A short one is the documented cause of generic,
    // off-design imagery, so it fails here rather than surfacing later as a bad photo.
    if (!req.subject?.trim()) problems.push(`Asset "${req.slot}" has no subject.`);
    else if (req.subject.trim().length < 40) {
      problems.push(`Asset "${req.slot}" has too thin a subject to generate from: "${req.subject.trim()}".`);
    }
  }
  return problems;
}
