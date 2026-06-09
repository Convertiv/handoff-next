import 'server-only';

import { getDataProvider } from '@/lib/data/index';
import { serializeFoundationsFromTokens } from './design-prompt-builder';

export async function buildDesignSystemContext(pageContext?: {
  type: 'component' | 'pattern';
  id: string;
}): Promise<string> {
  const provider = getDataProvider();

  const [components, tokens, patterns] = await Promise.all([
    provider.getComponents(),
    provider.getTokens(),
    provider.getPatterns(),
  ]);

  const foundations = serializeFoundationsFromTokens(tokens);

  // Build component context section
  let focusedSection = '';
  if (pageContext?.type === 'component') {
    const comp = components.find((c) => c.id === pageContext.id);
    if (comp) {
      const propsJson = JSON.stringify(comp.properties ?? {});
      const truncatedProps = propsJson.length > 2000 ? propsJson.slice(0, 2000) + '...' : propsJson;
      focusedSection =
        `## Currently Viewing: ${comp.title} (${comp.id})\n` +
        `Group: ${comp.group ?? ''} | Type: ${comp.type ?? 'component'}\n` +
        `Description: ${comp.description ?? ''}\n\n` +
        `Properties:\n${truncatedProps}\n\n`;
    }
  } else if (pageContext?.type === 'pattern') {
    const pattern = patterns.find((p) => p.id === pageContext.id);
    if (pattern) {
      focusedSection =
        `## Currently Viewing: ${pattern.title} (${pattern.id})\n` +
        `Group: ${pattern.group ?? ''} | Type: pattern\n` +
        `Description: ${pattern.description ?? ''}\n\n`;
    }
  }

  // Build components list — include image URL so AI can pass it through show_components
  const compLines = components.map((c) => {
    const title = (c.title ?? '').slice(0, 40);
    const group = (c.group ?? '').slice(0, 30);
    const desc = (c.description ?? '').slice(0, 100);
    const image = (c as { image?: string | null }).image ?? '';
    return `${c.id} | ${title} | ${group} | ${desc} | ${image}`;
  });

  // Build patterns list
  const patternLines = patterns.map((p) => {
    const title = (p.title ?? '').slice(0, 40);
    const desc = (p.description ?? '').slice(0, 100);
    return `${p.id} | ${title} | ${desc}`;
  });

  // Build token sections
  const colorLines = foundations.colors.map((c) => `- ${c.name}: ${c.value}`);
  const typoLines = foundations.typography.map((t) => `- ${t.name}: ${t.line}`);
  const spacingLines = foundations.spacing.map((s) => `- ${s.name}: ${s.value}`);
  const effectLines = foundations.effects.map((e) => `- ${e.name}: ${e.line}`);

  const tokenSection = [
    '## Design Tokens',
    '',
    '### Colors',
    ...colorLines,
    '',
    '### Typography',
    ...typoLines,
    '',
    '### Spacing',
    ...spacingLines,
    '',
    '### Effects',
    ...effectLines,
  ].join('\n');

  const preamble = `You are a helpful design system assistant with complete knowledge of this design system.
Answer questions about components, tokens, and patterns. Generate code using real token names.
Use markdown for code blocks. Be concise and helpful.

## How to handle multi-step design requests

When a user asks to **find** or **browse** components (e.g. "what heroes do I have?", "show me cards"):
1. Call \`show_components\` with the matching subset. Include screenshotUrl from the component list (5th column). Set \`recommendation\` to the best-fit component id. Write a short friendly text response explaining your recommendation.
2. Do NOT call navigate_component or open_design_workbench yet — let the user react first.

When a user has **chosen a component** and wants to **create a new variation** (e.g. "the hero split looks right, I need a version with a background image"):
1. Reply with a SHORT clarifying question asking for the specific content — headline, subtext, CTA label, image description, any special requirements.
2. Do NOT open the workbench yet.

When the user has provided **enough content detail** to generate a design:
1. Call \`open_design_workbench\` with: \`componentId\` = the chosen component's id, and \`generationPrompt\` = a clear, specific generation prompt that synthesizes the user's requirements (include the component name, the user's content, and any special instructions like "background image").
2. Also write a short text response telling the user you're opening the workbench.

For simple navigation to a single component → use \`navigate_component\`.
For simple pattern navigation → use \`navigate_pattern\`.
For code-based playground work → use \`open_playground\`.

## Component list (id | title | group | description | screenshotUrl)
`;

  const parts: string[] = [preamble];
  parts.push(compLines.join('\n'));
  parts.push('');

  if (focusedSection) {
    parts.push('## Currently Viewing');
    parts.push(focusedSection);
  }

  parts.push(tokenSection);
  parts.push('');
  parts.push(`## Patterns (${patterns.length}) (id | title | description)`);
  parts.push(patternLines.join('\n'));

  return parts.join('\n');
}
