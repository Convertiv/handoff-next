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

// ── Main spec generation ──────────────────────────────────────────────────────

function buildSpecPrompt(params: {
  classificationJson: string;
  extractedAssetKeys: string[];
  copyFromPrompt: string[];
  existingComponents: { id: string; title: string; propsJson: string }[];
  designMd: string;
  tokenSummary: string;
  brandVoice: string;
  reuseCatalog: { components: string[]; patterns: string[] };
}): string {
  const {
    classificationJson,
    extractedAssetKeys,
    copyFromPrompt,
    existingComponents,
    designMd,
    tokenSummary,
    brandVoice,
    reuseCatalog,
  } = params;

  let existingSection = '';
  if (existingComponents.length > 0) {
    existingSection = `\n\n## Existing component schemas to match against\n` +
      existingComponents.map(c => `### ${c.title} (id: ${c.id})\n${c.propsJson}`).join('\n\n');
  }

  const copySection = copyFromPrompt.length > 0
    ? `\n\n## UI copy strings extracted from the design prompt\n${copyFromPrompt.map(s => `- "${s}"`).join('\n')}`
    : '';

  const guidelinesSection = designMd ? `\n\n## Team design guidelines\n${designMd.slice(0, 2000)}` : '';

  // Only ask for the token/voice sections when we actually have something to match against.
  // Asking a vision model to map onto an empty token list invites invention, which is worse
  // than omitting the section.
  const tokenSection = tokenSummary
    ? `\n\n## The design system's REAL tokens — match observed values against THESE ONLY\n${tokenSummary}`
    : '';
  const voiceSection = brandVoice ? `\n\n## Brand voice guidelines to check the copy against\n${brandVoice.slice(0, 4000)}` : '';

  const tokensContract = tokenSummary
    ? `,
  "tokens": {
    "colors": [
      { "observed": "<value read off the design, e.g. #EBEAE1>", "usage": "<where, e.g. section background>", "token": "<exact token name from the list above, or null>", "reference": "<the → reference for that token, or null>", "matchLevel": "<exact|close|none>", "note": "<required unless exact: why, and what to do>" }
    ],
    "typography": [ { "observed": "<family weight size/lineheight>", "usage": "<e.g. headline>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
    "spacing": [ { "observed": "<e.g. 32px>", "usage": "<e.g. gap between CTAs>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
    "radii": [ { "observed": "<e.g. 8px>", "usage": "<e.g. button corners>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
    "coverage": <0.0-1.0 — share of observed values with matchLevel "exact">,
    "notes": "<one or two sentences on overall design-system adherence>"
  }`
    : '';

  const hasCatalog = reuseCatalog.components.length > 0 || reuseCatalog.patterns.length > 0;
  const reuseSection = hasCatalog
    ? `\n\n## What the team ALREADY has — prefer composing from these over inventing new parts` +
      (reuseCatalog.components.length ? `\n\n### Existing components\n${reuseCatalog.components.map((c) => `- ${c}`).join('\n')}` : '') +
      (reuseCatalog.patterns.length ? `\n\n### Existing patterns (already-composed layouts)\n${reuseCatalog.patterns.map((p) => `- ${p}`).join('\n')}` : '')
    : '';

  const reuseContract = hasCatalog
    ? `,
  "reuse": {
    "candidates": [
      { "componentId": "<id from the existing components list>", "title": "<its title>", "role": "<which part of THIS design it would cover>", "confidence": <0.0-1.0>, "note": "<how it would be used, or what would need to change>" }
    ],
    "patterns": [ { "patternId": "<id from the existing patterns list>", "title": "<its title>", "note": "<why it fits>" } ],
    "compositionScore": <0.0-1.0 — share of this design buildable from the lists above>,
    "recommendation": "<one or two sentences: compose from what exists, or genuinely build new — and why>"
  }`
    : '';

  const voiceContract = brandVoice
    ? `,
  "voice": {
    "findings": [
      { "text": "<the copy string>", "role": "<heading|subhead|cta|body|label>", "verdict": "<pass|warn|fail>", "rule": "<banned-phrase|length|tone|preferred-phrase>", "detail": "<what the guideline says and how this copy measures up>", "suggestion": "<concrete rewrite — required when verdict is warn or fail>" }
    ],
    "bannedPhrasesFound": ["<only phrases from the guidelines' avoid list that literally appear>"],
    "score": <0.0-1.0 — share of findings with verdict "pass">,
    "summary": "<one sentence>"
  }`
    : '';

  return `You are generating a detailed component specification from a UI design screenshot and extracted assets.

## Classification
${classificationJson}

## Extracted asset keys (use these as variant keys where applicable)
${extractedAssetKeys.join(', ')}
${copySection}${existingSection}${guidelinesSection}${reuseSection}${tokenSection}${voiceSection}

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
    "existingComponentMatches": ${existingComponents.length > 0
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
      : '[]'},
    "dependencies": ["<other component ids this depends on>"],
    "cssNotes": "<CSS/styling notes for the developer>",
    "developerHints": ["<hint>"]
  }${reuseContract}${tokensContract}${voiceContract}
}

Rules:
- Include at least 1 variant (default). Add more for each extracted state key.
- textInventory: transcribe ALL visible text in the design image.
- copyFromPrompt: use the provided array verbatim.
- If existing components were provided, evaluate each for matchLevel and fill existingComponentMatches accordingly.${
    hasCatalog
      ? `
- reuse: this is the most important section. Default to composition — assume the design SHOULD be
  built from existing components and patterns, and only conclude otherwise when nothing in the
  catalog fits. Break the design into its parts and name a candidate for each part you can.
- reuse: use ONLY ids that appear in the lists above; never invent one. If a candidate is an
  imperfect fit, still list it and say what would need to change in note — a near-miss the team
  can adapt is more valuable than silence.
- reuse: if an existing pattern already covers the whole layout, say so plainly in recommendation.
  Rebuilding something that already exists is the outcome this section exists to prevent.`
      : ''
  }${
    tokenSummary
      ? `
- tokens: NEVER invent a token name. Use only names from the token list above; when an observed
  value has no counterpart there, set token and reference to null with matchLevel "none" and say
  so in note. Reporting an off-system value honestly is far more useful than a false match.
- tokens: use "close" when the observed value is within a couple of units/shades of a real token —
  that is the actionable case ("snap this to X"), so always name the token you'd snap to.`
      : ''
  }${
    brandVoice
      ? `
- voice: check every heading, subhead and CTA. Apply the guidelines' length rules literally
  (count the words) and flag any phrase on the avoid list as verdict "fail".
- voice: bannedPhrasesFound must contain only phrases that literally appear in the copy — do not
  list a phrase merely because the copy is similar in spirit.`
      : ''
  }
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

export async function generateSpecForArtifact(artifactId: string): Promise<void> {
  // Callers (the design-artifact route and the MCP tool) set `specStatus: 'pending'` *before*
  // scheduling this. Returning silently here would leave the row on `pending` forever with no
  // reason surfaced — write a terminal status instead so the UI can explain itself.
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    const existing = await getDesignArtifactById(artifactId);
    const meta =
      existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {};
    meta.specError = 'HANDOFF_AI_API_KEY is not configured on the server.';
    await updateDesignArtifactById(artifactId, {
      specStatus: 'failed',
      metadata: meta,
    } as Parameters<typeof updateDesignArtifactById>[1]);
    return;
  }

  // Mark as generating
  await updateDesignArtifactById(artifactId, { specStatus: 'generating' } as Parameters<typeof updateDesignArtifactById>[1]);

  try {
    const row = await getDesignArtifactById(artifactId);
    if (!row?.imageUrl?.trim()) {
      await updateDesignArtifactById(artifactId, { specStatus: 'failed' } as Parameters<typeof updateDesignArtifactById>[1]);
      return;
    }

    const assets = (Array.isArray(row.assets) ? row.assets : []) as ExtractedAssetV2[];
    const overview = assets.find(a => a.key === 'annotated_overview') ?? assets[0];
    const imageForSpec = overview?.imageUrl ?? row.imageUrl;
    const extractedKeys = assets.filter(a => a.key !== 'annotated_overview').map(a => a.key);

    // Gather context
    const copyFromPrompt = extractCopyFromHistory(row.conversationHistory);
    const existingComponents = await loadComponentSchemasForGuides(row.componentGuides);

    // Build vision parts for the spec call
    const visionPart = await imageUrlToVisionPart(imageForSpec, 'high');
    const classificationGuess = {
      componentType: 'other' as const,
      suggestedName: row.title || 'Component',
      visibleStates: extractedKeys.filter(k => k.startsWith('state_')).map(k => k.replace('state_', '')),
      subComponents: [],
      hasIcons: extractedKeys.includes('icons'),
      hasMedia: extractedKeys.includes('media'),
      complexity: 'medium' as const,
    };
    if (!classificationGuess.visibleStates.length) classificationGuess.visibleStates = ['default'];

    // Workspace context: the team's design guidelines, the registry's real tokens, and the
    // brand voice. `designMd` was previously hardcoded to '' here, so the spec never saw the
    // team guidelines at all. All three degrade to '' independently — a registry with no DTCG
    // dimension tokens or no brand voice still gets a spec, just without those sections.
    const [workspace, tokenSummary, reuseCatalog] = await Promise.all([
      getDesignWorkspace().catch(() => null),
      getTokenSummary().catch(() => null),
      loadReuseCatalog().catch(() => ({ components: [], patterns: [] })),
    ]);
    const tokenSummaryText = tokenSummary && !isTokenSummaryEmpty(tokenSummary) ? formatTokenSummaryForPrompt(tokenSummary) : '';
    const brandVoiceText = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';

    const systemPrompt = buildSpecPrompt({
      classificationJson: JSON.stringify(classificationGuess, null, 2),
      extractedAssetKeys: ['default', ...extractedKeys],
      copyFromPrompt,
      existingComponents,
      designMd: workspace?.designMd ?? '',
      tokenSummary: tokenSummaryText,
      brandVoice: brandVoiceText,
      reuseCatalog,
    });

    const messages: Parameters<typeof openAiChatJson>[0] = [
      { role: 'system', content: systemPrompt },
    ];
    if (visionPart) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Generate the ComponentSpec JSON for this design:' }, visionPart] });
    } else {
      messages.push({ role: 'user', content: 'Generate the ComponentSpec JSON for this design based on the context provided.' });
    }

    const raw = await openAiChatJson(messages, {
      actorUserId: row.userId,
      route: 'design-spec-generate',
      eventType: 'ai.design_spec_generate',
      model: SPEC_MODEL(),
      maxTokens: 4000,
    });

    const spec = parseSpec(raw, row.title || 'Component');
    if (!spec) {
      await updateDesignArtifactById(artifactId, { specStatus: 'failed' } as Parameters<typeof updateDesignArtifactById>[1]);
      return;
    }

    spec.generatedAt = new Date().toISOString();
    const specMd = specToMarkdown(spec);

    await updateDesignArtifactById(artifactId, {
      componentSpec: spec as unknown as Parameters<typeof updateDesignArtifactById>[1]['componentSpec'],
      componentSpecMd: specMd,
      specStatus: 'done',
    } as Parameters<typeof updateDesignArtifactById>[1]);

    console.log('[design-spec-generator] spec generated for', artifactId, spec.overview.name);
  } catch (e) {
    console.error('[design-spec-generator] failed', artifactId, e);
    await updateDesignArtifactById(artifactId, { specStatus: 'failed' } as Parameters<typeof updateDesignArtifactById>[1]);
  }
}
