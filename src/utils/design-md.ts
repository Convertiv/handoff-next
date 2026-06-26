/**
 * DESIGN.md generator (roadmap Phase D, D1). Pure formatter — no I/O, no server
 * deps — so it's unit-testable and reusable by the MCP tool (D1), the push
 * pipeline (D2), and the CLAUDE.md stanza generator (D3).
 *
 * Produces a compact, agent-facing framing brief: system identity, a token brief
 * (colors by group, type scale, spacing/radius), component vocabulary, brand
 * voice, and design guidelines. Committable to a project and referenced from
 * CLAUDE.md so an agent has design-system context without a live MCP call.
 */

interface SlimColor {
  name?: string;
  value?: unknown;
  group?: string;
  sass?: string;
  reference?: string;
}
interface SlimTypography {
  name?: string;
  reference?: string;
  values?: { fontFamily?: unknown; fontSize?: unknown; fontWeight?: unknown };
}
interface DimToken {
  name?: string;
  value?: unknown;
  cssVariable?: string;
  description?: string;
}
interface ComponentLite {
  id?: string;
  title?: string;
  group?: string;
}

export interface DesignMdInput {
  project?: { name?: string; stackProfile?: string; figmaFileKey?: string | null; origin?: string };
  colors?: SlimColor[];
  typography?: SlimTypography[];
  spacing?: DimToken[];
  borderRadius?: DimToken[];
  grid?: DimToken[];
  components?: ComponentLite[];
  brandVoiceMarkdown?: string;
  designGuidelines?: string;
}

const MAX_PER_COLOR_GROUP = 16;

function colorRef(c: SlimColor): string {
  return c.sass || (c.reference ? `--${c.reference}` : c.name || '');
}

function buildColorSection(colors: SlimColor[]): string {
  if (!colors.length) return '';
  const groups = new Map<string, SlimColor[]>();
  for (const c of colors) {
    const g = c.group || 'other';
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(c);
  }
  const lines: string[] = ['## Colors', ''];
  for (const [group, items] of groups) {
    lines.push(`### ${group}`);
    for (const c of items.slice(0, MAX_PER_COLOR_GROUP)) {
      const ref = colorRef(c);
      lines.push(`- \`${ref}\` — ${String(c.value ?? '')}${c.name ? ` (${c.name})` : ''}`);
    }
    if (items.length > MAX_PER_COLOR_GROUP) lines.push(`- …and ${items.length - MAX_PER_COLOR_GROUP} more`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildTypographySection(typography: SlimTypography[]): string {
  if (!typography.length) return '';
  const lines = ['## Typography', ''];
  for (const t of typography) {
    const v = t.values ?? {};
    const bits = [v.fontFamily, v.fontSize ? `${v.fontSize}px` : undefined, v.fontWeight]
      .filter(Boolean)
      .join(' · ');
    lines.push(`- **${t.name ?? t.reference}**${bits ? ` — ${bits}` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildDimSection(title: string, tokens: DimToken[]): string {
  if (!tokens.length) return '';
  const lines = [`## ${title}`, ''];
  for (const d of tokens) {
    const name = d.cssVariable || d.name || '';
    lines.push(`- \`${name}\` — ${String(d.value ?? '')}${d.description ? ` (${d.description})` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildComponentSection(components: ComponentLite[]): string {
  if (!components.length) return '';
  const groups = new Map<string, ComponentLite[]>();
  for (const c of components) {
    const g = c.group || 'Components';
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(c);
  }
  const lines = ['## Component vocabulary', ''];
  for (const [group, items] of groups) {
    lines.push(`### ${group}`);
    for (const c of items) lines.push(`- \`${c.id}\`${c.title && c.title !== c.id ? ` — ${c.title}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function trimSection(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

export function buildDesignMd(input: DesignMdInput): string {
  const p = input.project ?? {};
  const rawName = p.name && p.name.trim() && p.name.trim() !== 'default' ? p.name.trim() : '';
  const title = rawName ? `${rawName} — Design System` : 'Design System';

  const header: string[] = [`# ${title}`, ''];
  const identity = [
    p.stackProfile ? `- **Stack:** ${p.stackProfile}` : '',
    p.figmaFileKey ? `- **Figma source:** \`${p.figmaFileKey}\`` : '',
    p.origin ? `- **Registry:** ${p.origin}` : '',
  ].filter(Boolean);
  if (identity.length) {
    header.push('## System identity', '', ...identity, '');
  }
  header.push(
    '> Use the token names below (`$sass` / `--css-var`) directly in code, the listed component',
    "> ids as the real building blocks, and the brand voice for copy. Don't invent values.",
    ''
  );

  const sections = [
    header.join('\n'),
    buildColorSection(input.colors ?? []),
    buildTypographySection(input.typography ?? []),
    buildDimSection('Spacing', input.spacing ?? []),
    buildDimSection('Border radius', input.borderRadius ?? []),
    buildDimSection('Grid', input.grid ?? []),
    buildComponentSection(input.components ?? []),
    input.brandVoiceMarkdown ? `## Brand voice\n\n${input.brandVoiceMarkdown.trim()}` : '',
    input.designGuidelines ? `## Design guidelines\n\n${input.designGuidelines.trim()}` : '',
  ].filter(Boolean);

  return trimSection(sections.join('\n\n')) + '\n';
}
