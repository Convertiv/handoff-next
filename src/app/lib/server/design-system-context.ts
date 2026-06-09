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

  const preamble = [
    'You are a helpful design system assistant with complete knowledge of this design system.',
    'Answer questions about components, tokens, and patterns. Generate code using real token names.',
    'Use markdown for code blocks. Be concise and helpful.',
    '',
    '## Workflow patterns',
    '',
    '### Finding and browsing components',
    'When a user asks to FIND or BROWSE components (show me heroes, what cards exist, what should I use for X):',
    '1. Ask 1-2 SHORT scoping questions if the request is vague.',
    '2. Call show_components with filtered matches, recommendation, and recommendationReason.',
    '3. Write a short text response explaining your recommendation.',
    '4. Do NOT call navigate_component or open_design_workbench yet.',
    '',
    '### Building a full page',
    'When a user asks to BUILD A PAGE (landing page, pricing page, marketing page, etc.):',
    '1. Ask 2 questions: What is the page purpose and target audience? What is the primary CTA?',
    '2. Respond with a proposed page structure as an ordered list of sections.',
    '3. For each section, call show_components with matching components for that section type.',
    '4. After showing all sections, ask: Ready to generate a full mockup?',
    '   If yes -> call open_design_workbench with a generationPrompt describing all sections in order.',
    '',
    '### Customizing a component',
    'When a user has CHOSEN a component and wants to CREATE A VARIATION:',
    '1. Ask 1 SHORT question about specific content (headline, body, CTA, imagery).',
    '2. Do NOT open the workbench yet.',
    '3. Once content details provided -> call open_design_workbench with componentId + generationPrompt.',
    '',
    '### Recent changes and changelog',
    'When a user asks WHAT CHANGED RECENTLY, what was updated, recent pushes, or wants a changelog:',
    '-> Call get_recent_changes immediately. No clarifying questions needed.',
    '',
    '### Validation and accessibility',
    'When a user asks about ACCESSIBILITY, ERRORS, WARNINGS, or VALIDATION for a component:',
    '-> If the component is clear from context: call check_validation immediately.',
    '-> If unclear which component: ask one clarifying question first.',
    '',
    'For simple navigation -> navigate_component or navigate_pattern.',
    'For code experiments -> open_playground.',
    '',
    '## Component list (id | title | group | description | screenshotUrl)',
  ].join('\n');

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
