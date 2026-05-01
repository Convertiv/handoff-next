import 'server-only';

import type { ChatMessage } from '@/lib/server/ai-client';
import { openAiChatJson } from '@/lib/server/ai-client';
import { imageUrlToVisionPart } from '@/lib/server/component-generation-images';
import type { RendererKind } from '@/lib/server/component-scaffold';
import type { handoffDesignArtifacts } from '@/lib/db/schema';

type ArtifactRow = typeof handoffDesignArtifacts.$inferSelect;

export type LlmGeneratedComponent = {
  title: string;
  description: string;
  group: string;
  type: string;
  properties: Record<string, unknown>;
  previews: Record<string, { title: string; values: Record<string, unknown> }>;
  entrySources: {
    template?: string;
    component?: string;
    story?: string;
    scss: string;
    js: string;
  };
};

function rendererRules(renderer: RendererKind, scssPreamble: string): string {
  const scssGuidance = scssPreamble
    ? `Begin the SCSS with the same import preamble the project uses:\n\`\`\`\n${scssPreamble}\n\`\`\`\nThen add component-specific rules below.`
    : `If the project's similar-component examples include an @import preamble, replicate it exactly. Otherwise start SCSS with a comment and use var(--color-*) for colors.`;

  const rules: Record<RendererKind, string> = {
    handlebars: `Use Handlebars (.hbs) with Bootstrap 5 utility classes (d-flex, row, col-*, gap-*, fw-bold, text-muted, rounded-3, etc.). ${scssGuidance} Scope custom rules under a class named after the component id.`,
    react: `Use React + TSX with functional components. Prefer utility classes consistent with the project (Tailwind-style if implied by examples). Export default component + Props interface. ${scssGuidance}`,
    csf: `Use CSF3-style Storybook file: default export meta + named exports for stories. Include at least two previews mapped via component props. ${scssGuidance}`,
  };
  return rules[renderer];
}

function a11yInstructions(standard: string): string {
  if (standard === 'wcag-aaa') return 'Meet WCAG 2.1 AAA intent: strong contrast, semantic headings, aria labels on interactive controls, visible focus.';
  if (standard === 'wcag-aa') return 'Meet WCAG 2.1 AA intent: sufficient contrast, semantic HTML, alt text on images, keyboard-focusable controls.';
  return 'Follow sensible semantic HTML; no formal WCAG level required.';
}

export type AssetRef = { label: string; httpPath: string };

export async function generateComponentWithLlm(opts: {
  artifact: ArtifactRow;
  componentId: string;
  renderer: RendererKind;
  behaviorPrompt: string;
  a11yStandard: string;
  useExtractedAssets: boolean;
  referenceMarkdown: string;
  foundationBlock: string;
  similarExamplesMarkdown: string;
  /** SCSS import preamble discovered from existing project components. */
  scssPreamble?: string;
  /** Persisted asset file references the model can use in code. */
  assetRefs?: AssetRef[];
  refinement?: {
    differences: string[];
    a11yNotes: string[];
    previous: LlmGeneratedComponent;
  };
  actorUserId?: string | null;
}): Promise<LlmGeneratedComponent> {
  const { artifact, componentId, renderer, behaviorPrompt, a11yStandard, useExtractedAssets } = opts;

  const system = `You are an expert Handoff design-system engineer. Output a single JSON object (no markdown fences) with this shape:
{
  "title": string,
  "description": string,
  "group": string,
  "type": "block" | "element" | "template",
  "properties": { "<propName>": { "name", "description", "type", "default", "rules" } },
  "previews": {
    "generic": { "title": string, "values": { ...matches properties } },
    "design": { "title": string, "values": { ...realistic copy from the design image } }
  },
  "entrySources": {
    ${renderer === 'handlebars' ? '"template": string (full .hbs),' : ''}
    ${renderer === 'react' ? '"component": string (full .tsx),' : ''}
    ${renderer === 'csf' ? '"story": string (full .stories.tsx),' : ''}
    "scss": string,
    "js": string (minimal client script, can be almost empty comment)
  }
}
Rules:
- Exactly two previews: keys must be "generic" (lorem / placeholders) and "design" (text and labels faithful to the design image — read every word of text visible in the image and reproduce it exactly).
- Reuse tokens / CSS variables from reference materials; avoid hardcoded hex except in comments.
- Minimize custom SCSS; prefer utilities in template.
- Component id is "${componentId}" — use in data-component, BEM root class, or file-appropriate naming.
- ${rendererRules(renderer, opts.scssPreamble ?? '')}
- Accessibility: ${a11yInstructions(a11yStandard)}
- IMAGES: When extracted asset images are provided with HTTP paths, use those exact paths in your template (e.g. as <img src="..."> or background-image URLs) and in preview values. This is critical — do not use placeholder URLs like "https://example.com/image.jpg".
- VISUAL FIDELITY: Study the target design image carefully. Match the layout precisely: column ratios, spacing, font sizes, colors, border radius, shadows, background images. The "design" preview values must contain the real text from the design image, not lorem ipsum.
`;

  const assetRefs = opts.assetRefs ?? [];
  const assetRefBlock = assetRefs.length > 0
    ? `\n## Extracted asset files (use these URLs in your template and preview values)\n${assetRefs.map((a, i) => `- Asset ${i}: "${a.label}" → ${a.httpPath}`).join('\n')}\n`
    : '';

  const userParts: ChatMessage['content'] = [
    {
      type: 'text',
      text: `Component id: ${componentId}\nRenderer: ${renderer}\nBehavior / interaction notes:\n${behaviorPrompt || '(none)'}\n\n## Project reference materials\n${opts.referenceMarkdown.slice(0, 24000)}\n\n## Similar components\n${opts.similarExamplesMarkdown.slice(0, 12000)}\n${opts.foundationBlock}${assetRefBlock}\n${opts.refinement ? `\n## Refinement pass\nAddress:\n${opts.refinement.differences.map((d) => `- ${d}`).join('\n')}\nA11y notes:\n${opts.refinement.a11yNotes.map((d) => `- ${d}`).join('\n')}\n\nPrevious entrySources (improve, do not shrink functionality):\n${JSON.stringify(opts.refinement.previous.entrySources).slice(0, 8000)}\n` : ''}`,
    },
  ];

  const designPart = await imageUrlToVisionPart(artifact.imageUrl);
  if (designPart) userParts.push({ type: 'text', text: 'Target design image (study this carefully — match layout, text, colors, and images):' }, designPart);
  else userParts.push({ type: 'text', text: '(No design image available.)' });

  if (useExtractedAssets && Array.isArray(artifact.assets)) {
    let n = 0;
    for (const a of artifact.assets as { imageUrl?: string; label?: string }[]) {
      if (n >= 4) break;
      const u = typeof a?.imageUrl === 'string' ? a.imageUrl : '';
      const part = await imageUrlToVisionPart(u);
      if (part) {
        const ref = assetRefs.find((r) => r.label === a?.label);
        const refNote = ref ? ` — USE this path in your code: ${ref.httpPath}` : '';
        userParts.push({ type: 'text', text: `Extracted asset: ${a?.label || 'asset'}${refNote}` }, part);
        n += 1;
      }
    }
  }

  const raw = await openAiChatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: userParts },
    ],
    {
      actorUserId: opts.actorUserId,
      route: 'component-generation-llm',
      eventType: 'ai.component_generate',
      model: process.env.HANDOFF_COMPONENT_GEN_MODEL?.trim() || 'gpt-4o',
      maxTokens: 16384,
    }
  );

  return parseGeneratedComponentJson(raw, renderer, componentId);
}

function parseGeneratedComponentJson(raw: string, renderer: RendererKind, componentId: string): LlmGeneratedComponent {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const title = String(parsed.title || 'Generated');
  const description = String(parsed.description || '');
  const group = String(parsed.group || 'Content');
  const type = String(parsed.type || 'block');
  const properties =
    parsed.properties && typeof parsed.properties === 'object' ? (parsed.properties as Record<string, unknown>) : {};
  const previewsRaw = parsed.previews && typeof parsed.previews === 'object' ? (parsed.previews as Record<string, unknown>) : {};
  const previews: LlmGeneratedComponent['previews'] = {};
  for (const [k, v] of Object.entries(previewsRaw)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const values = (o.values && typeof o.values === 'object' ? o.values : {}) as Record<string, unknown>;
    previews[k] = { title: String(o.title || k), values };
  }
  if (!previews.generic) previews.generic = { title: 'Generic', values: {} };
  if (!previews.design) previews.design = { title: 'From design', values: { ...previews.generic.values } };

  const es = parsed.entrySources && typeof parsed.entrySources === 'object' ? (parsed.entrySources as Record<string, unknown>) : {};
  const scss = typeof es.scss === 'string' ? es.scss : '/* */\n';
  const js = typeof es.js === 'string' ? es.js : '//\n';
  const entrySources: LlmGeneratedComponent['entrySources'] = { scss, js };
  if (renderer === 'handlebars' && typeof es.template === 'string') entrySources.template = es.template;
  if (renderer === 'react' && typeof es.component === 'string') entrySources.component = es.component;
  if (renderer === 'csf' && typeof es.story === 'string') entrySources.story = es.story;

  if (renderer === 'handlebars' && !entrySources.template) {
    entrySources.template = `<head>\n  {{{style}}}\n  {{{script}}}\n</head>\n<body class="theme preview-body">\n  <section data-component="${componentId}"><p>{{title}}</p></section>\n</body>\n`;
  }
  if (renderer === 'react' && !entrySources.component) {
    entrySources.component = `import React from 'react';\nexport default function Generated() { return <div className="theme preview-body">Generated</div>; }\n`;
  }
  if (renderer === 'csf' && !entrySources.story) {
    entrySources.story = `import React from 'react';\nconst X = () => <div className="theme preview-body">Generated</div>;\nexport default { title: 'Gen', component: X };\nexport const Generic = { render: () => <X /> };\n`;
  }

  return { title, description, group, type, properties, previews, entrySources };
}
