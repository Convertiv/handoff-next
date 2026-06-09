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

  // Build components list
  const compLines = components.map((c) => {
    const title = (c.title ?? '').slice(0, 20);
    const group = (c.group ?? '').slice(0, 20);
    const desc = (c.description ?? '').slice(0, 80);
    return `${c.id} | ${title} | ${group} | ${desc}`;
  });

  // Build patterns list
  const patternLines = patterns.map((p) => {
    const title = (p.title ?? '').slice(0, 20);
    const desc = (p.description ?? '').slice(0, 80);
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
    'When you mention a specific component or pattern, call the appropriate navigation tool.',
    'When asked to build or generate UI, call the open_playground or open_design_workbench tool.',
    'Use markdown for code blocks. Be concise.',
    '',
  ].join('\n');

  const parts: string[] = [preamble];

  if (focusedSection) {
    parts.push(focusedSection);
  }

  parts.push(`## Components (${components.length})`);
  parts.push(compLines.join('\n'));
  parts.push('');
  parts.push(tokenSection);
  parts.push('');
  parts.push(`## Patterns (${patterns.length})`);
  parts.push(patternLines.join('\n'));

  return parts.join('\n');
}
