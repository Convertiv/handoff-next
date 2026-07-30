import 'server-only';

import { getDesignArtifactById, updateDesignArtifactById } from '@/lib/db/queries';
import { openAiChatJson } from '@/lib/server/ai-client';
import { imageUrlToVisionPart } from '@/lib/server/component-generation-images';
import { getDataProvider } from '@/lib/data';
import { getDesignWorkspace, formatBrandVoiceForPrompt } from '@/lib/server/design-workspace';
import { getTokenSummary, isTokenSummaryEmpty, formatTokenSummaryForPrompt } from '@/lib/server/design-token-summary';
import type { ComponentSpec, ExtractedAssetV2, TokenMatch } from '@/lib/server/design-spec-types';

const SPEC_MODEL = () => process.env.HANDOFF_SPEC_MODEL?.trim() || process.env.HANDOFF_AI_MODEL?.trim() || 'gpt-4.1';

// ── Prompt copy extraction ────────────────────────────────────────────────────

function extractCopyFromHistory(conversationHistory: unknown): string[] {
  if (!Array.isArray(conversationHistory)) return [];
  const results: string[] = [];
  const QUOTED_RE = /"([^"]{2,120})"/g;
  const COPY_PATTERN_RE = /(?:label|text|copy|says?|reads?|titled?|named?|called?|button|heading|placeholder)[:\s]+["']?([A-Z][^"'\n]{2,80})/gi;
  for (const turn of conversationHistory) {
    if (!turn || typeof turn !== 'object') continue;
    const t = turn as Record<string, unknown>;
    if (t.role !== 'user' || typeof t.prompt !== 'string') continue;
    const prompt = t.prompt;
    let m: RegExpExecArray | null;
    QUOTED_RE.lastIndex = 0;
    while ((m = QUOTED_RE.exec(prompt)) !== null) {
      const s = m[1].trim();
      if (s.length >= 3 && !results.includes(s)) results.push(s);
    }
    COPY_PATTERN_RE.lastIndex = 0;
    while ((m = COPY_PATTERN_RE.exec(prompt)) !== null) {
      const s = m[1].trim().replace(/["']$/, '');
      if (s.length >= 3 && !results.includes(s)) results.push(s);
    }
  }
  return results.slice(0, 20);
}

// ── Existing component schemas for matching ───────────────────────────────────

async function loadComponentSchemasForGuides(componentGuides: unknown): Promise<{ id: string; title: string; propsJson: string }[]> {
  if (!Array.isArray(componentGuides) || componentGuides.length === 0) return [];
  try {
    const provider = getDataProvider();
    const results: { id: string; title: string; propsJson: string }[] = [];
    for (const guide of componentGuides) {
      if (!guide || typeof guide !== 'object') continue;
      const g = guide as Record<string, unknown>;
      const id = typeof g.id === 'string' ? g.id.trim() : '';
      if (!id) continue;
      const row = await provider.getComponent(id);
      if (!row) continue;
      results.push({
        id,
        title: row.title || id,
        propsJson: JSON.stringify(row.properties ?? {}, null, 2).slice(0, 4000),
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ── Reuse catalog ─────────────────────────────────────────────────────────────

/**
 * A light catalog of everything the team already has, for the spec's `reuse` section.
 *
 * Deliberately id + title + group only. Full prop schemas are reserved for
 * `loadComponentSchemasForGuides`, which runs on the handful of components the user explicitly
 * attached; pulling props for an entire library would blow the prompt budget and isn't needed to
 * answer "could this be built from existing parts?".
 */
async function loadReuseCatalog(): Promise<{ components: string[]; patterns: string[] }> {
  const provider = getDataProvider();
  const MAX = 120;

  const components = await provider
    .getComponentSummaries()
    .then((rows) =>
      (rows ?? []).slice(0, MAX).map((c) => {
        const r = c as unknown as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id : '';
        const title = typeof r.title === 'string' ? r.title : id;
        const group = typeof r.group === 'string' && r.group ? ` [${r.group}]` : '';
        return `${id} — ${title}${group}`;
      })
    )
    .catch(() => [] as string[]);

  const patterns = await provider
    .getPatterns()
    .then((rows) =>
      (rows ?? []).slice(0, MAX).map((p) => {
        const r = p as unknown as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id : '';
        const title = typeof r.title === 'string' ? r.title : id;
        return `${id} — ${title}`;
      })
    )
    .catch(() => [] as string[]);

  return { components: components.filter(Boolean), patterns: patterns.filter(Boolean) };
}

// ── Prompts ───────────────────────────────────────────────────────────────────
//
// The specification is assembled from four independent model calls rather than one, in two rounds:
// round 1 = base spec + tokens (both need the image), round 2 = reuse + voice (both text-only, and
// both need what the base spec learned from the image).
//
// Why: a single call carrying the component catalog, the token list, the brand voice and the design
// guidelines — and required to emit all four sections at once — exceeded a 270s budget on live 8x8
// and self-failed every time. Split, the calls run concurrently (latency ≈ the slowest, not the
// sum), each is independently retryable, and two of them need no image at all. A failure in one
// section degrades that section instead of losing the whole specification.

function buildSpecPrompt(params: {
  classificationJson: string;
  extractedAssetKeys: string[];
  copyFromPrompt: string[];
  existingComponents: { id: string; title: string; propsJson: string }[];
  designMd: string;
}): string {
  const { classificationJson, extractedAssetKeys, copyFromPrompt, existingComponents, designMd } = params;

  let existingSection = '';
  if (existingComponents.length > 0) {
    existingSection =
      `\n\n## Existing component schemas to match against\n` +
      existingComponents.map((c) => `### ${c.title} (id: ${c.id})\n${c.propsJson}`).join('\n\n');
  }

  const copySection =
    copyFromPrompt.length > 0
      ? `\n\n## UI copy strings extracted from the design prompt\n${copyFromPrompt.map((s) => `- "${s}"`).join('\n')}`
      : '';

  const guidelinesSection = designMd ? `\n\n## Team design guidelines\n${designMd.slice(0, 2000)}` : '';

  return `You are generating a detailed component specification from a UI design screenshot and extracted assets.

## Classification
${classificationJson}

## Extracted asset keys (use these as variant keys where applicable)
${extractedAssetKeys.join(', ')}
${copySection}${existingSection}${guidelinesSection}

## Instructions
Generate a complete ComponentSpec JSON object. Follow this EXACT schema — every field is required:

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
    { "key": "<asset key or 'default'>", "name": "<display name>", "description": "<what differs>", "isDefault": true|false }
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
    "requiredAriaAttributes": ["<aria-label>", "<aria-expanded>", ...],
    "keyboardNav": [{ "key": "<Tab|Enter|Space|Arrow>", "action": "<what happens>" }],
    "screenReaderNotes": "<what a screen reader user experiences>",
    "wcagTarget": "AA"
  },
  "content": {
    "textInventory": [
      { "text": "<visible text>", "role": "<heading|label|button|body|placeholder|error|badge|helper|link>", "location": "<where in component>", "editable": true|false }
    ],
    "copyFromPrompt": ${JSON.stringify(copyFromPrompt)},
    "rules": [{ "field": "<field name>", "maxLength": <number or omit>, "notes": "<guideline>" }]
  },
  "implementation": {
    "existingComponentMatches": ${
      existingComponents.length > 0
        ? `[
      {
        "componentId": "<matched component id or empty string>",
        "componentTitle": "<matched component title>",
        "matchLevel": "<exact|variation|similar>",
        "confidence": <0.0-1.0>,
        "propMapping": [{ "specProp": "<spec prop name>", "existingProp": "<existing prop name>", "suggestedValue": "<value if deterministic>" }],
        "missingProps": ["<props in spec not found in existing component>"],
        "sampleConfig": { "<existingProp>": "<value>" },
        "recommendation": "<one sentence — e.g. Use Button with variant=primary"
      }
    ]`
        : '[]'
    },
    "dependencies": ["<other component ids this depends on>"],
    "cssNotes": "<LAYOUT and STRUCTURE notes only — grid/columns, stacking, alignment, overflow, responsive behaviour. No concrete colour, size, spacing or radius values.>",
    "developerHints": ["<hint>"]
  },
  "assetRequirements": [
    { "slot": "<the prop this image fills, e.g. backgroundImage>", "kind": "<photo|illustration>", "subject": "<what the image DEPICTS — subject, setting, mood, treatment. Content only.>", "aspect": "<1:1|3:2|2:3|16:9>", "minWidth": <intrinsic width in CSS px the slot needs at 1x>, "focalPoint": "<where the subject sits, e.g. center-right>", "formats": ["<jpeg|webp|png>"] }
  ]
}

Rules:
- Include at least 1 variant (default). Add more for each extracted state key.
- textInventory: transcribe ALL visible text in the design image.
- assetRequirements: list ONLY genuine photographic or illustrative content — the images a developer
  would have to source or commission. Backgrounds that are a flat colour or gradient are TOKENS, not
  assets. Component states are CSS. Icons come from the icon library. Buttons, cards and panels are
  components. If the design contains no photographs or illustrations, return an empty array.
- assetRequirements.subject: describe only what the image DEPICTS. Never describe layout, overlaid
  text, buttons or surrounding UI — this text becomes the prompt for generating the image on its own,
  and anything structural in it produces a screenshot of a component instead of a usable asset.
- assetRequirements.aspect/minWidth: infer from the slot's role in the layout, not from the composite's
  overall dimensions — a right-hand hero photo and a full-bleed banner need different ratios.
- copyFromPrompt: use the provided array verbatim.
- If existing components were provided, evaluate each for matchLevel and fill existingComponentMatches accordingly.
- cssNotes and developerHints: describe LAYOUT and STRUCTURE only. Do NOT state specific hex colours,
  font sizes, spacing values or border radii. Those are resolved separately against the design
  system's real tokens, and a value here contradicts that mapping — on a live run this section claimed
  "Teal (#00A3BF)" and "8px border-radius" for a design whose actual tokens were #04888a and 12px.
  Worth knowing where those came from: NOT model invention. 8x8's Design.MD literally says "the 8x8
  primary teal (#00A3BF)" and "Cards use 8px border-radius", neither of which exists in their token
  set. Prose guidance and the token system drift apart, and when they do the tokens are the truth —
  which is exactly why this section must name intent and let the mapping supply the value. Describe the intent ("primary action colour", "card corner radius") and let the token
  mapping supply the value.
- Return ONLY valid JSON — no markdown, no commentary.`;
}

/**
 * Reuse: text-only, and run AFTER the base spec.
 *
 * It needs a real description of the design, not its pixels — but the only rich description comes
 * from the base spec, which is the call that actually looked at the image. An earlier revision ran
 * reuse concurrently with the base spec and fed it the pre-spec `classificationGuess`, whose
 * `componentType` is literally `'other'` and whose name is the artifact title ("Draft — 7/29/2026").
 * Asked what could build *that*, the model correctly answered "nothing" and returned
 * `compositionScore: 0` for a design that 8x8's `hero-form` matches almost exactly. Starving this
 * call of context is what broke it, not the catalog or the prompt.
 */
function buildReusePrompt(params: {
  specSummary: string;
  reuseCatalog: { components: string[]; patterns: string[] };
}): string {
  const { specSummary, reuseCatalog } = params;
  return `You decide whether a new UI design should be COMPOSED from a design system's existing parts, or genuinely built new.

## The design
${specSummary}

## What the team ALREADY has
${reuseCatalog.components.length ? `### Existing components\n${reuseCatalog.components.map((c) => `- ${c}`).join('\n')}` : ''}
${reuseCatalog.patterns.length ? `\n### Existing patterns (already-composed layouts)\n${reuseCatalog.patterns.map((p) => `- ${p}`).join('\n')}` : ''}

## Instructions
Return ONLY this JSON:
{
  "candidates": [
    { "componentId": "<id from the list above>", "title": "<its title>", "role": "<which part of THIS design it would cover>", "confidence": <0.0-1.0>, "note": "<how it would be used, or what would need to change>" }
  ],
  "patterns": [ { "patternId": "<id from the list above>", "title": "<its title>", "note": "<why it fits>" } ],
  "compositionScore": <0.0-1.0 — share of this design buildable from the lists above>,
  "recommendation": "<one or two sentences: compose from what exists, or genuinely build new — and why>"
}

Rules:
- Default to composition. Assume the design SHOULD be built from existing parts, and conclude otherwise only when nothing fits.
- Break the design into its parts and name a candidate for each part you can.
- Use ONLY ids that appear above. NEVER invent one.
- List near-misses too, saying in note what would need to change — an adaptable near-miss beats silence.
- If an existing pattern already covers the whole layout, say so plainly in recommendation.
- Return ONLY valid JSON — no markdown, no commentary.`;
}

/** Tokens: needs the image, to read actual values off the design. */
function buildTokenPrompt(params: { tokenSummary: string }): string {
  return `You map the visual values in a UI design onto a design system's REAL tokens.

## The design system's tokens — match against THESE ONLY
${params.tokenSummary}

## Instructions
Read the colours, type, spacing and corner radii off the design image and return ONLY this JSON:
{
  "colors": [
    { "observed": "<value read off the design, e.g. #EBEAE1>", "usage": "<where, e.g. section background>", "token": "<exact token name from above, or null>", "reference": "<the → reference for that token, or null>", "matchLevel": "<exact|close|none>", "note": "<required unless exact: why, and what to do>" }
  ],
  "typography": [ { "observed": "<family weight size/lineheight>", "usage": "<e.g. headline>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "spacing": [ { "observed": "<e.g. 32px>", "usage": "<e.g. gap between CTAs>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "radii": [ { "observed": "<e.g. 8px>", "usage": "<e.g. button corners>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "coverage": <0.0-1.0 — share of observed values with matchLevel "exact">,
  "notes": "<one or two sentences on overall design-system adherence>"
}

Rules:
- NEVER invent a token name. Use only names from the list above; when an observed value has no counterpart there, set token and reference to null with matchLevel "none" and say so in note. An honest "off-system" is far more useful than a false match.
- Use "close" when the value is within a couple of units/shades of a real token — that is the actionable case ("snap this to X"), so always name the token you would snap to.
- Estimate spacing and radii in pixels; approximate is fine, say so in note.
- Return ONLY valid JSON — no markdown, no commentary.`;
}

/** Voice: text-only. Needs the copy strings and the guidance, not the image. */
function buildVoicePrompt(params: { copyStrings: { text: string; role: string }[]; brandVoice: string }): string {
  const { copyStrings, brandVoice } = params;
  return `You check UI copy against a brand's voice guidelines.

## Brand voice guidelines
${brandVoice.slice(0, 6000)}

## The copy in this design
${copyStrings.map((c) => `- [${c.role}] "${c.text}"`).join('\n')}

## Instructions
Return ONLY this JSON:
{
  "findings": [
    { "text": "<the copy string>", "role": "<heading|subhead|cta|body|label>", "verdict": "<pass|warn|fail>", "rule": "<banned-phrase|length|tone|preferred-phrase>", "detail": "<what the guideline says and how this copy measures up>", "suggestion": "<concrete rewrite — required when verdict is warn or fail>" }
  ],
  "bannedPhrasesFound": ["<only phrases from the guidelines' avoid list that literally appear>"],
  "score": <0.0-1.0 — share of findings with verdict "pass">,
  "summary": "<one sentence>"
}

Rules:
- Check every heading, subhead and CTA. Apply length rules literally — count the words.
- Any phrase on the avoid list is verdict "fail".
- bannedPhrasesFound must contain only phrases that LITERALLY appear in the copy. Do not list a phrase because the copy is similar in spirit.
- If the guidelines contradict each other on a phrase, say so in that finding's detail rather than guessing.
- Return ONLY valid JSON — no markdown, no commentary.`;
}

function parseSpec(raw: string, fallbackName: string): ComponentSpec | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const o = JSON.parse(cleaned) as ComponentSpec;
    if (!o.overview || !o.props) return null;
    if (!o.overview.name) o.overview.name = fallbackName;
    o.version = 1;
    if (!o.generatedAt) o.generatedAt = new Date().toISOString();
    return o;
  } catch {
    return null;
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function specToMarkdown(spec: ComponentSpec): string {
  const lines: string[] = [];

  lines.push(`# ${spec.overview.name}`);
  lines.push('');
  lines.push(`**Type:** ${spec.overview.type} · **Group:** ${spec.overview.designSystemGroup}`);
  lines.push('');
  lines.push(spec.overview.summary || spec.overview.description);

  // Variants
  if (spec.variants.length > 0) {
    lines.push('', '## Variants');
    for (const v of spec.variants) {
      lines.push(`- **${v.name}**${v.isDefault ? ' *(default)*' : ''}: ${v.description}`);
    }
  }

  // Props
  if (spec.props.length > 0) {
    lines.push('', '## Props');
    lines.push('| Prop | Type | Required | Default | Description |');
    lines.push('|------|------|----------|---------|-------------|');
    for (const p of spec.props) {
      const type = p.options && p.options.length ? `\`${p.options.join(' | ')}\`` : `\`${p.type}\``;
      lines.push(`| \`${p.name}\` | ${type} | ${p.required ? '✓' : '—'} | ${p.defaultValue ? `\`${p.defaultValue}\`` : '—'} | ${p.description} |`);
    }
  }

  // Behavior
  if (spec.behavior.interactions.length > 0 || spec.behavior.edgeCases.length > 0) {
    lines.push('', '## Behavior');
    if (spec.behavior.interactions.length > 0) {
      lines.push('', '**Interactions**');
      for (const i of spec.behavior.interactions) {
        lines.push(`- **${i.trigger}** → ${i.action}`);
      }
    }
    if (spec.behavior.transitions.length > 0) {
      lines.push('', '**Transitions**');
      for (const t of spec.behavior.transitions) lines.push(`- ${t}`);
    }
    if (spec.behavior.edgeCases.length > 0) {
      lines.push('', '**Edge cases**');
      for (const e of spec.behavior.edgeCases) lines.push(`- ${e}`);
    }
  }

  // Accessibility
  lines.push('', '## Accessibility');
  lines.push(`- **ARIA role:** \`${spec.accessibility.ariaRole}\``);
  if (spec.accessibility.requiredAriaAttributes.length > 0) {
    lines.push(`- **Required attributes:** ${spec.accessibility.requiredAriaAttributes.map(a => `\`${a}\``).join(', ')}`);
  }
  if (spec.accessibility.keyboardNav.length > 0) {
    lines.push('', '**Keyboard navigation**');
    for (const k of spec.accessibility.keyboardNav) {
      lines.push(`- \`${k.key}\` → ${k.action}`);
    }
  }
  if (spec.accessibility.screenReaderNotes) {
    lines.push('', `**Screen reader:** ${spec.accessibility.screenReaderNotes}`);
  }
  lines.push(`- **WCAG target:** ${spec.accessibility.wcagTarget}`);

  // Content
  if (spec.content.textInventory.length > 0) {
    lines.push('', '## Content');
    lines.push('', '**Text inventory**');
    for (const t of spec.content.textInventory) {
      lines.push(`- \`${t.role}\` · *${t.location}*: "${t.text}"${t.editable ? ' *(prop)*' : ''}`);
    }
    if (spec.content.copyFromPrompt.length > 0) {
      lines.push('', '**Copy from design prompt**');
      for (const c of spec.content.copyFromPrompt) lines.push(`- "${c}"`);
    }
    if (spec.content.rules.length > 0) {
      lines.push('', '**Rules**');
      for (const r of spec.content.rules) {
        lines.push(`- **${r.field}**${r.maxLength ? ` (max ${r.maxLength} chars)` : ''}: ${r.notes}`);
      }
    }
  }

  // Implementation
  if (spec.implementation.existingComponentMatches.length > 0) {
    const best = spec.implementation.existingComponentMatches.sort((a, b) => b.confidence - a.confidence)[0];
    if (best.confidence >= 0.5) {
      lines.push('', '## Existing component match');
      lines.push(`**${best.componentTitle}** (confidence: ${Math.round(best.confidence * 100)}%, match: ${best.matchLevel})`);
      lines.push('', best.recommendation);
      if (Object.keys(best.sampleConfig).length > 0) {
        lines.push('', '```json', JSON.stringify(best.sampleConfig, null, 2), '```');
      }
    }
  }

  if (spec.implementation.cssNotes || spec.implementation.developerHints.length > 0) {
    lines.push('', '## Implementation notes');
    if (spec.implementation.cssNotes) lines.push(spec.implementation.cssNotes);
    for (const h of spec.implementation.developerHints) lines.push(`- ${h}`);
    // These notes come from the call that reads the image, not the one that resolves tokens, so any
    // concrete value here is an estimate. Point the reader at the authoritative mapping rather than
    // letting the two sections quietly disagree.
    if (spec.tokens) {
      lines.push('', '> Concrete colour, type, spacing and radius values are resolved in **Design tokens** below — use those, not any values named here.');
    }
  }

  if (spec.reuse && (spec.reuse.candidates?.length || spec.reuse.patterns?.length || spec.reuse.recommendation)) {
    const r = spec.reuse;
    lines.push('', '## Build from what exists', '', `Composition score: **${Math.round((r.compositionScore ?? 0) * 100)}%**`);
    if (r.recommendation) lines.push('', `**${r.recommendation}**`);
    if (r.patterns?.length) {
      lines.push('', '### Existing patterns that already fit', '');
      for (const p of r.patterns) lines.push(`- **${p.title}** (\`${p.patternId}\`) — ${p.note}`);
    }
    if (r.candidates?.length) {
      lines.push('', '### Existing components to compose from', '', '| Component | Covers | Confidence | Notes |', '|---|---|---|---|');
      for (const c of r.candidates) {
        lines.push(`| **${c.title}** \`${c.componentId}\` | ${c.role} | ${Math.round((c.confidence ?? 0) * 100)}% | ${c.note} |`);
      }
    }
  }

  if (spec.tokens) {
    const t = spec.tokens;
    const groups: [string, TokenMatch[]][] = [
      ['Color', t.colors ?? []],
      ['Typography', t.typography ?? []],
      ['Spacing', t.spacing ?? []],
      ['Radius', t.radii ?? []],
    ];
    const any = groups.some(([, rows]) => rows.length > 0);
    if (any) {
      lines.push('', '## Design tokens', '', `Token coverage: **${Math.round((t.coverage ?? 0) * 100)}%**`);
      if (t.notes) lines.push('', t.notes);
      for (const [label, rows] of groups) {
        if (!rows.length) continue;
        lines.push('', `### ${label}`, '', '| Observed | Used for | Token | Reference | Match |', '|---|---|---|---|---|');
        for (const r of rows) {
          const mark = r.matchLevel === 'exact' ? '✅ exact' : r.matchLevel === 'close' ? '⚠️ close' : '❌ off-system';
          lines.push(`| \`${r.observed}\` | ${r.usage} | ${r.token ?? '—'} | ${r.reference ? `\`${r.reference}\`` : '—'} | ${mark} |`);
          if (r.note && r.matchLevel !== 'exact') lines.push(`| | | | | ${r.note} |`);
        }
      }
    }
  }

  if (spec.voice) {
    const v = spec.voice;
    lines.push('', '## Brand voice', '', `Voice compliance: **${Math.round((v.score ?? 0) * 100)}%**`);
    if (v.summary) lines.push('', v.summary);
    if (v.bannedPhrasesFound?.length) {
      lines.push('', `> ⚠️ Contains phrases on the avoid list: ${v.bannedPhrasesFound.map((p) => `"${p}"`).join(', ')}`);
    }
    if (v.findings?.length) {
      lines.push('', '| Copy | Role | Verdict | Notes |', '|---|---|---|---|');
      for (const f of v.findings) {
        const mark = f.verdict === 'pass' ? '✅' : f.verdict === 'warn' ? '⚠️' : '❌';
        const detail = f.suggestion ? `${f.detail} — *suggested:* "${f.suggestion}"` : f.detail;
        lines.push(`| "${f.text}" | ${f.role} | ${mark} ${f.verdict} | ${detail} |`);
      }
    }
  }

  return lines.join('\n');
}

// ── Orchestration entry point ─────────────────────────────────────────────────

/** Parse a section response, tolerating a fenced code block. Null on malformed JSON. */
function parseSection<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()) as T;
  } catch {
    return null;
  }
}

/** Write `specStatus: failed` with a reason the UI can display. */
async function failSpec(artifactId: string, reason: string): Promise<void> {
  const existing = await getDesignArtifactById(artifactId);
  const meta =
    existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {};
  meta.specError = reason;
  await updateDesignArtifactById(artifactId, {
    specStatus: 'failed',
    metadata: meta,
  } as Parameters<typeof updateDesignArtifactById>[1]).catch(() => undefined);
}

/**
 * A description of the design good enough to reason about reuse, built from the base spec.
 *
 * This is what the reuse call gets instead of the pre-spec classification guess — the spec is the
 * only artefact that has actually seen the image.
 */
function specSummaryForReuse(spec: ComponentSpec): string {
  const ov = spec.overview ?? ({} as ComponentSpec['overview']);
  const lines = [
    `Name: ${ov.name ?? 'Component'}`,
    `Type: ${ov.type ?? 'other'}${ov.designSystemGroup ? ` (group: ${ov.designSystemGroup})` : ''}`,
    ov.summary ? `Summary: ${ov.summary}` : '',
    ov.description ? `Description: ${ov.description}` : '',
  ].filter(Boolean);

  const parts = (spec.content?.textInventory ?? [])
    .slice(0, 24)
    .map((t) => `  - [${t.role}] "${t.text}"${t.location ? ` (${t.location})` : ''}`);
  if (parts.length) lines.push('', 'Visible content:', ...parts);

  const props = (spec.props ?? []).slice(0, 20).map((p) => `  - ${p.name}: ${p.type}`);
  if (props.length) lines.push('', 'Props identified:', ...props);

  return lines.join('\n');
}

/** Copy strings for the voice check: prefer the spec's transcribed text, fall back to the prompt. */
function copyStringsForVoice(spec: ComponentSpec, copyFromPrompt: string[]): { text: string; role: string }[] {
  const inventory = (spec.content?.textInventory ?? [])
    .filter((t) => typeof t.text === 'string' && t.text.trim().length > 1)
    .map((t) => ({ text: t.text.trim(), role: t.role || 'body' }));
  if (inventory.length) return inventory.slice(0, 40);
  return copyFromPrompt.slice(0, 40).map((text) => ({ text, role: 'body' }));
}

export async function generateSpecForArtifact(artifactId: string): Promise<void> {
  // Callers (the design-artifact route and the MCP tool) set `specStatus: 'pending'` *before*
  // scheduling this. Returning silently here would leave the row on `pending` forever with no
  // reason surfaced — write a terminal status instead so the UI can explain itself.
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    await failSpec(artifactId, 'HANDOFF_AI_API_KEY is not configured on the server.');
    return;
  }

  await updateDesignArtifactById(artifactId, { specStatus: 'generating' } as Parameters<typeof updateDesignArtifactById>[1]);

  try {
    const row = await getDesignArtifactById(artifactId);
    if (!row?.imageUrl?.trim()) {
      await failSpec(artifactId, 'No composite image on artifact.');
      return;
    }

    const assets = (Array.isArray(row.assets) ? row.assets : []) as ExtractedAssetV2[];
    const overview = assets.find((a) => a.key === 'annotated_overview') ?? assets[0];
    const imageForSpec = overview?.imageUrl ?? row.imageUrl;
    const extractedKeys = assets.filter((a) => a.key !== 'annotated_overview').map((a) => a.key);

    const copyFromPrompt = extractCopyFromHistory(row.conversationHistory);
    const existingComponents = await loadComponentSchemasForGuides(row.componentGuides);
    const visionPart = await imageUrlToVisionPart(imageForSpec, 'high');

    const classificationGuess = {
      componentType: 'other' as const,
      suggestedName: row.title || 'Component',
      visibleStates: extractedKeys.filter((k) => k.startsWith('state_')).map((k) => k.replace('state_', '')),
      subComponents: [],
      hasIcons: extractedKeys.includes('icons'),
      hasMedia: extractedKeys.includes('media'),
      complexity: 'medium' as const,
    };
    if (!classificationGuess.visibleStates.length) classificationGuess.visibleStates = ['default'];
    const classificationJson = JSON.stringify(classificationGuess, null, 2);

    // Workspace context. All three degrade independently — a registry with no DTCG dimension
    // tokens, or no brand voice, still gets a specification, just without those sections.
    const [workspace, tokenSummary, reuseCatalog] = await Promise.all([
      getDesignWorkspace().catch(() => null),
      getTokenSummary().catch(() => null),
      loadReuseCatalog().catch(() => ({ components: [], patterns: [] })),
    ]);
    const tokenSummaryText = tokenSummary && !isTokenSummaryEmpty(tokenSummary) ? formatTokenSummaryForPrompt(tokenSummary) : '';
    const brandVoiceText = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';
    const hasCatalog = reuseCatalog.components.length > 0 || reuseCatalog.patterns.length > 0;

    const call = (systemPrompt: string, userText: string, withImage: boolean, eventType: string, maxTokens: number) => {
      const messages: Parameters<typeof openAiChatJson>[0] = [{ role: 'system', content: systemPrompt }];
      if (withImage && visionPart) {
        messages.push({ role: 'user', content: [{ type: 'text', text: userText }, visionPart] });
      } else {
        messages.push({ role: 'user', content: userText });
      }
      return openAiChatJson(messages, {
        actorUserId: row.userId,
        route: 'design-spec-generate',
        eventType,
        model: SPEC_MODEL(),
        maxTokens,
      });
    };

    // ── Round 1: base spec + tokens, concurrently (both need the image) ─────
    // Only the base spec is required.
    const [baseRaw, tokensRes] = await Promise.all([
      call(
        buildSpecPrompt({
          classificationJson,
          extractedAssetKeys: ['default', ...extractedKeys],
          copyFromPrompt,
          existingComponents,
          designMd: workspace?.designMd ?? '',
        }),
        'Generate the ComponentSpec JSON for this design:',
        true,
        'ai.design_spec_generate',
        4000
      ),
      tokenSummaryText
        ? call(
            buildTokenPrompt({ tokenSummary: tokenSummaryText }),
            'Map this design onto the design system tokens:',
            true,
            'ai.design_spec_tokens',
            2500
          )
            .then((raw) => parseSection<NonNullable<ComponentSpec['tokens']>>(raw))
            .catch((err) => {
              console.warn('[design-spec-generator] tokens section failed', artifactId, err);
              return null;
            })
        : Promise.resolve(null),
    ]);

    const spec = parseSpec(baseRaw, row.title || 'Component');
    if (!spec) {
      await failSpec(artifactId, 'The model returned a specification that could not be parsed. Re-run the dev handoff.');
      return;
    }

    if (tokensRes) spec.tokens = tokensRes;

    // ── Round 2: reuse + voice, concurrently ────────────────────────────────
    // Both are text-only and cheap, and both need what the base spec learned from the image —
    // reuse needs a real description of the design, voice needs the copy actually transcribed.
    // Running them after the base spec costs little and is the difference between reuse working
    // and reuse being asked about a component called "Draft — 7/29/2026".
    const [reuseRes, voiceRes] = await Promise.all([
      hasCatalog
        ? call(
            buildReusePrompt({ specSummary: specSummaryForReuse(spec), reuseCatalog }),
            'Decide what this design should be composed from:',
            false,
            'ai.design_spec_reuse',
            2000
          )
            .then((raw) => parseSection<NonNullable<ComponentSpec['reuse']>>(raw))
            .catch((err) => {
              console.warn('[design-spec-generator] reuse section failed', artifactId, err);
              return null;
            })
        : Promise.resolve(null),
      (() => {
        if (!brandVoiceText) return Promise.resolve(null);
        const copyStrings = copyStringsForVoice(spec, copyFromPrompt);
        if (!copyStrings.length) return Promise.resolve(null);
        return call(
          buildVoicePrompt({ copyStrings, brandVoice: brandVoiceText }),
          'Check this copy against the brand voice:',
          false,
          'ai.design_spec_voice',
          2000
        )
          .then((raw) => parseSection<NonNullable<ComponentSpec['voice']>>(raw))
          .catch((err) => {
            console.warn('[design-spec-generator] voice section failed', artifactId, err);
            return null;
          });
      })(),
    ]);

    if (reuseRes) spec.reuse = reuseRes;
    if (voiceRes) spec.voice = voiceRes;

    spec.generatedAt = new Date().toISOString();
    const specMd = specToMarkdown(spec);

    await updateDesignArtifactById(artifactId, {
      componentSpec: spec as unknown as Parameters<typeof updateDesignArtifactById>[1]['componentSpec'],
      componentSpecMd: specMd,
      specStatus: 'done',
    } as Parameters<typeof updateDesignArtifactById>[1]);

    // Append to the spec's version history, diffed against the previous version. The artifact row
    // above remains the current-version cache; this is what makes "what changed and why" durable.
    // Never throws, and a regenerate producing an identical spec is skipped rather than recorded.
    const { recordSpecVersion } = await import('@/lib/spec/versioning');
    await recordSpecVersion({
      artifactId,
      spec,
      specMd,
      source: 'generated',
      createdByUserId: row.userId,
    });

    console.log(
      '[design-spec-generator] spec generated for',
      artifactId,
      spec.overview.name,
      `(tokens:${spec.tokens ? 'y' : 'n'} reuse:${spec.reuse ? 'y' : 'n'} voice:${spec.voice ? 'y' : 'n'})`
    );
  } catch (e) {
    console.error('[design-spec-generator] failed', artifactId, e);
    await failSpec(artifactId, e instanceof Error ? e.message.slice(0, 2000) : 'Specification generation failed.');
  }
}

// ── Brief-driven generation (spec-first) ──────────────────────────────────────

/**
 * Write a specification from the design brief, before any image exists.
 *
 * The counterpart to `generateSpecForArtifact`, which reads a composite screenshot. That direction
 * makes the image the source and the spec its report, which forces the whole chain backwards: assets
 * can only be planned from a spec, a spec could only be written from an image, so the image had to come
 * first — and the assets it then "declares" are regenerated from a one-line description of a photo that
 * already exists. They cannot match; the asset generator has never seen the design.
 *
 * Here the brief produces the spec, the spec declares its imagery, the imagery is generated, and the
 * composite is assembled from it. The image becomes a rendering of the specification.
 *
 * Deliberately does NOT produce `tokens`. That section is a conformance measurement of observed values
 * against the registry, and nothing has been rendered yet — emitting one would report a coverage score
 * for a design that does not exist. It is filled in later, when the spec is re-run against the produced
 * composite. `reuse` and `voice` are text-only and are produced here, since both work from the spec.
 */
export async function generateSpecFromBrief(artifactId: string): Promise<void> {
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    await failSpec(artifactId, 'HANDOFF_AI_API_KEY is not configured on the server.');
    return;
  }

  await updateDesignArtifactById(artifactId, { specStatus: 'generating' } as Parameters<typeof updateDesignArtifactById>[1]);

  try {
    const row = await getDesignArtifactById(artifactId);
    if (!row) {
      await failSpec(artifactId, 'Artifact not found.');
      return;
    }

    // The brief is what the user actually asked for. Without it there is nothing to specify — and
    // falling back to the title would silently produce a spec for a design nobody described.
    const brief = briefFromArtifact(row);
    if (!brief) {
      await failSpec(
        artifactId,
        'This design has no brief to write a specification from. Spec-first generation needs the original request.'
      );
      return;
    }

    const copyFromPrompt = extractCopyFromHistory(row.conversationHistory);
    const existingComponents = await loadComponentSchemasForGuides(row.componentGuides);

    const [workspace, tokenSummary, reuseCatalog] = await Promise.all([
      getDesignWorkspace().catch(() => null),
      getTokenSummary().catch(() => null),
      loadReuseCatalog().catch(() => ({ components: [], patterns: [] })),
    ]);
    const tokenSummaryText = tokenSummary && !isTokenSummaryEmpty(tokenSummary) ? formatTokenSummaryForPrompt(tokenSummary) : '';
    const brandVoiceText = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';
    const hasCatalog = reuseCatalog.components.length > 0 || reuseCatalog.patterns.length > 0;

    const call = (systemPrompt: string, userText: string, eventType: string, maxTokens: number) =>
      openAiChatJson([{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }], {
        actorUserId: row.userId,
        route: 'design-spec-brief',
        eventType,
        model: SPEC_MODEL(),
        maxTokens,
      });

    const { buildBriefSpecPrompt, briefSpecProblems, stripMeasuredSections } = await import('@/lib/spec/brief-spec');

    const baseRaw = await call(
      buildBriefSpecPrompt({
        brief,
        copyFromPrompt,
        tokenSummary: tokenSummaryText,
        brandVoice: brandVoiceText,
        designMd: workspace?.designMd ?? '',
        existingComponents,
      }),
      'Write the ComponentSpec JSON for this brief:',
      'ai.design_spec_brief',
      4000
    );

    const parsed = parseSpec(baseRaw, row.title || 'Component');
    // A thin spec produces a thin design, and the run looks successful right up until someone opens
    // the image. Fail here, where the reason is still legible.
    const problems = briefSpecProblems(parsed);
    if (!parsed || problems.length) {
      await failSpec(artifactId, `The brief specification is not usable: ${problems.join(' ')}`);
      return;
    }
    const spec = stripMeasuredSections(parsed);

    // Reuse and voice are text-only and need only the spec — same as round 2 of the image path.
    const [reuseRes, voiceRes] = await Promise.all([
      hasCatalog
        ? call(
            buildReusePrompt({ specSummary: specSummaryForReuse(spec), reuseCatalog }),
            'Decide what this design should be composed from:',
            'ai.design_spec_reuse',
            2000
          )
            .then((raw) => parseSection<NonNullable<ComponentSpec['reuse']>>(raw))
            .catch((err) => {
              console.warn('[design-spec-generator] brief reuse section failed', artifactId, err);
              return null;
            })
        : Promise.resolve(null),
      (() => {
        if (!brandVoiceText) return Promise.resolve(null);
        const copyStrings = copyStringsForVoice(spec, copyFromPrompt);
        if (!copyStrings.length) return Promise.resolve(null);
        return call(
          buildVoicePrompt({ copyStrings, brandVoice: brandVoiceText }),
          'Check this copy against the brand voice:',
          'ai.design_spec_voice',
          2000
        )
          .then((raw) => parseSection<NonNullable<ComponentSpec['voice']>>(raw))
          .catch((err) => {
            console.warn('[design-spec-generator] brief voice section failed', artifactId, err);
            return null;
          });
      })(),
    ]);

    if (reuseRes) spec.reuse = reuseRes;
    if (voiceRes) spec.voice = voiceRes;

    spec.generatedAt = new Date().toISOString();
    const specMd = specToMarkdown(spec);

    await updateDesignArtifactById(artifactId, {
      componentSpec: spec as unknown as Parameters<typeof updateDesignArtifactById>[1]['componentSpec'],
      componentSpecMd: specMd,
      specStatus: 'done',
    } as Parameters<typeof updateDesignArtifactById>[1]);

    const { recordSpecVersion } = await import('@/lib/spec/versioning');
    await recordSpecVersion({
      artifactId,
      spec,
      specMd,
      source: 'generated',
      changeReason: 'Specification written from the brief, before any image existed.',
      createdByUserId: row.userId,
    });

    console.log(
      '[design-spec-generator] brief spec written for',
      artifactId,
      spec.overview.name,
      `(assets:${(spec.assetRequirements ?? []).length} reuse:${spec.reuse ? 'y' : 'n'} voice:${spec.voice ? 'y' : 'n'})`
    );
  } catch (e) {
    console.error('[design-spec-generator] brief spec failed', artifactId, e);
    await failSpec(artifactId, e instanceof Error ? e.message.slice(0, 2000) : 'Specification generation failed.');
  }
}

/**
 * The user's original request for this artifact.
 *
 * Prefers the conversation history, since that is where the actual wording lives; falls back to the
 * stored description. Returns null rather than substituting the title — a title like
 * "Draft — 7/29/2026" is not a brief, and specifying against it would produce confident nonsense.
 */
function briefFromArtifact(row: { conversationHistory?: unknown; description?: string | null }): string | null {
  const history = Array.isArray(row.conversationHistory) ? row.conversationHistory : [];
  const prompts: string[] = [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const role = typeof e.role === 'string' ? e.role : '';
    const content = typeof e.content === 'string' ? e.content : typeof e.prompt === 'string' ? e.prompt : '';
    if (role === 'user' && content.trim()) prompts.push(content.trim());
  }
  // Every turn, in order: a refinement ("make it two columns") is meaningless without the request it
  // refines, so the brief is the conversation rather than only its most recent line.
  if (prompts.length) return prompts.join('\n\n').slice(0, 8000);

  const description = (row.description ?? '').trim();
  return description || null;
}

/**
 * Measure the rendered design against the registry's real tokens, and merge the result into the spec.
 *
 * The conformance pass that spec-first was missing. A brief-written specification deliberately carries no
 * `tokens` section — that section reports which *observed* values map onto real tokens, and before
 * anything is rendered there is nothing to observe. Emitting one at authoring time would be a coverage
 * score for a design that does not exist.
 *
 * So it runs here instead, after the composite: same token-mapping call the image-first path has always
 * used, pointed at the image the pipeline just produced. That keeps the section's meaning intact —
 * always a measurement of a real rendering, never a guess — and closes the gap where a spec-first design
 * simply never got one.
 *
 * Only `tokens` is touched. `voice` is measured against the copy the spec authored, which rendering does
 * not change, and re-running it here would just spend a call to reach the same answer.
 *
 * Never throws: a failed measurement leaves the spec without the section, exactly as before, rather than
 * failing a design that is otherwise complete.
 */
export async function measureTokenConformance(artifactId: string): Promise<{ measured: boolean; reason?: string }> {
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) return { measured: false, reason: 'AI is not configured.' };

  const row = await getDesignArtifactById(artifactId);
  if (!row) return { measured: false, reason: 'Artifact not found.' };
  if (!row.imageUrl?.trim()) return { measured: false, reason: 'No rendered image to measure.' };

  const spec = (row.componentSpec ?? null) as ComponentSpec | null;
  if (!spec) return { measured: false, reason: 'No specification to attach the measurement to.' };

  const tokenSummary = await getTokenSummary().catch(() => null);
  if (!tokenSummary || isTokenSummaryEmpty(tokenSummary)) {
    // A registry with no tokens is a legitimate state, not a failure — say so instead of reporting 0%
    // coverage, which would read as "this design is off-system" rather than "there is nothing to check".
    return { measured: false, reason: 'The registry has no tokens to measure against.' };
  }

  const visionPart = await imageUrlToVisionPart(row.imageUrl, 'high');
  if (!visionPart) return { measured: false, reason: 'The rendered image could not be read.' };

  let tokens: NonNullable<ComponentSpec['tokens']> | null = null;
  try {
    const raw = await openAiChatJson(
      [
        { role: 'system', content: buildTokenPrompt({ tokenSummary: formatTokenSummaryForPrompt(tokenSummary) }) },
        { role: 'user', content: [{ type: 'text', text: 'Map this design onto the design system tokens:' }, visionPart] },
      ],
      {
        actorUserId: row.userId,
        route: 'design-spec-conformance',
        eventType: 'ai.design_spec_tokens',
        model: SPEC_MODEL(),
        maxTokens: 2500,
      }
    );
    tokens = parseSection<NonNullable<ComponentSpec['tokens']>>(raw);
  } catch (err) {
    console.warn('[design-spec-generator] token conformance failed', artifactId, err);
    return { measured: false, reason: err instanceof Error ? err.message.slice(0, 500) : 'The measurement failed.' };
  }
  if (!tokens) return { measured: false, reason: 'The measurement could not be parsed.' };

  const next: ComponentSpec = { ...spec, tokens };
  const specMd = specToMarkdown(next);
  await updateDesignArtifactById(artifactId, {
    componentSpec: next as unknown as Parameters<typeof updateDesignArtifactById>[1]['componentSpec'],
    componentSpecMd: specMd,
  } as Parameters<typeof updateDesignArtifactById>[1]);

  // Recorded as a version so the stored spec and its latest version never disagree. Without this the
  // current spec would carry a tokens section that no version in the history accounts for.
  const { recordSpecVersion } = await import('@/lib/spec/versioning');
  await recordSpecVersion({
    artifactId,
    spec: next,
    specMd,
    source: 'generated',
    changeReason: 'Measured the rendered design against the design system tokens.',
    createdByUserId: row.userId,
  });

  console.log('[design-spec-generator] token conformance measured for', artifactId, `coverage=${tokens.coverage ?? 'n/a'}`);
  return { measured: true };
}
