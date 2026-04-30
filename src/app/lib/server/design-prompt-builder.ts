import 'server-only';

import type {
  DesignConversationTurn,
  DesignWorkbenchComponentGuide,
  DesignWorkbenchFoundationContext,
} from '@/app/design/workbench-types';

export type { DesignConversationTurn, DesignWorkbenchComponentGuide, DesignWorkbenchFoundationContext };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/** Extract a compact foundation context from tokens.json / DB snapshot payload. */
export function serializeFoundationsFromTokens(payload: unknown): DesignWorkbenchFoundationContext {
  const doc = asRecord(payload);
  const local = doc ? asRecord(doc.localStyles) : null;
  const colors: DesignWorkbenchFoundationContext['colors'] = [];
  const typography: DesignWorkbenchFoundationContext['typography'] = [];
  const effects: DesignWorkbenchFoundationContext['effects'] = [];
  const spacing: DesignWorkbenchFoundationContext['spacing'] = [];

  const colorList = Array.isArray(local?.color) ? (local!.color as unknown[]) : [];
  for (const entry of colorList.slice(0, 120)) {
    const o = asRecord(entry);
    if (!o) continue;
    const name = pickString(o, ['name', 'title', 'id', 'key']);
    const value =
      pickString(o, ['value', 'hex', 'color', 'css']) ||
      (typeof o.values === 'object' && o.values !== null
        ? pickString(asRecord(o.values) ?? {}, ['hex', 'value', 'color'])
        : '');
    const group = pickString(o, ['group']);
    const subgroup = pickString(o, ['subgroup']);
    if (name || value) colors.push({ name: name || 'color', value: value || '—', group, subgroup });
  }

  const typoList = Array.isArray(local?.typography) ? (local!.typography as unknown[]) : [];
  for (const entry of typoList.slice(0, 32)) {
    const o = asRecord(entry);
    if (!o) continue;
    const name = pickString(o, ['name', 'title', 'id', 'key']);
    const vals = asRecord(o.values) ?? o;
    const font = pickString(vals, ['fontFamily', 'font', 'family']);
    const rawSize = pickString(vals, ['fontSize', 'size', 'fontSizePx']);
    const size = rawSize && !/px$/i.test(rawSize) ? `${rawSize}px` : rawSize;
    const weight = pickString(vals, ['fontWeight', 'weight', 'fontStyle']);
    const rawLh = pickString(vals, ['lineHeight', 'leading']);
    const lh = rawLh || '';
    const line = [font, size, weight, lh].filter(Boolean).join(' · ') || JSON.stringify(o).slice(0, 120);
    typography.push({ name: name || 'type', line });
  }

  const spacingList = Array.isArray(local?.spacing) ? (local!.spacing as unknown[]) : [];
  for (const entry of spacingList.slice(0, 32)) {
    const o = asRecord(entry);
    if (!o) continue;
    const name = pickString(o, ['name', 'title', 'id', 'key']);
    const value =
      pickString(o, ['value', 'px', 'rem', 'css']) ||
      (typeof o.values === 'object' && o.values !== null
        ? pickString(asRecord(o.values) ?? {}, ['value', 'px', 'rem'])
        : '');
    if (name || value) spacing.push({ name: name || 'space', value: value || '—' });
  }

  const effectList = Array.isArray(local?.effect) ? (local!.effect as unknown[]) : [];
  for (const entry of effectList.slice(0, 24)) {
    const o = asRecord(entry);
    if (!o) continue;
    const name = pickString(o, ['name', 'title', 'id', 'key']);
    const line = pickString(o, ['description', 'value', 'css']) || JSON.stringify(o).slice(0, 120);
    effects.push({ name: name || 'effect', line });
  }

  return { colors, typography, effects, spacing };
}

function formatFoundationsBlock(ctx: DesignWorkbenchFoundationContext): string {
  const lines: string[] = ['## Design system foundations (use strictly)'];
  if (ctx.colors.length) {
    lines.push('### Colors');
    for (const c of ctx.colors) lines.push(`- ${c.name}: ${c.value}`);
  } else {
    lines.push('### Colors', '- (none provided)');
  }
  if (ctx.typography.length) {
    lines.push('### Typography');
    for (const t of ctx.typography) lines.push(`- ${t.name}: ${t.line}`);
  }
  if (ctx.effects.length) {
    lines.push('### Effects / elevation');
    for (const e of ctx.effects) lines.push(`- ${e.name}: ${e.line}`);
  }
  if (ctx.spacing?.length) {
    lines.push('### Spacing scale');
    for (const s of ctx.spacing) lines.push(`- ${s.name}: ${s.value}`);
  }
  return lines.join('\n');
}

const SCREENSHOT_API_MARKER = '/api/handoff/ai/component-screenshot';

function formatComponentGuidesBlock(guides: DesignWorkbenchComponentGuide[]): string {
  if (!guides.length) return '## Component guides\n- (none selected)';
  const lines: string[] = ['## Component guides (layout / content patterns — do not copy pixels blindly; match semantics)'];
  for (const g of guides) {
    lines.push(`### ${g.title} (${g.id})${g.group ? ` — group: ${g.group}` : ''}`);
    if (g.previewKey) lines.push(`Selected preview variation key: ${g.previewKey}`);
    if (g.description) lines.push(g.description);
    if (g.propertiesSummary) lines.push(`Property schema (summary):\n${g.propertiesSummary}`);
    if (g.previewUrl?.includes(SCREENSHOT_API_MARKER)) {
      lines.push(
        'A raster screenshot of this component preview is included as one of the attached reference images for this request (PNG, same order as images sent to the image model).'
      );
    } else if (g.previewUrl) {
      lines.push(`Reference preview asset: ${g.previewUrl}`);
    }
  }
  return lines.join('\n');
}

function formatConversationBlock(history: DesignConversationTurn[]): string {
  if (!history.length) return '';
  const lines: string[] = ['## Prior iterations (continue from the latest visual intent)'];
  for (const turn of history) {
    const who = turn.role === 'user' ? 'User' : 'Assistant output';
    lines.push(`- **${who}**: ${turn.prompt}`);
  }
  return lines.join('\n');
}

const CANVAS_RULES = `## Output rules
- Canvas is 1024×1024. The UI section should only use the vertical height it needs; leave unused canvas area minimal and neutral (do not stretch content to fill the square).
- Match the design system's colors, typography, spacing, and component semantics described above.
- Produce a polished marketing/product UI suitable for web.`;

/**
 * Full prompt sent to the image model (foundations + guides + history + user request).
 */
export function buildDesignGenerationPrompt({
  userPrompt,
  foundationContext,
  componentGuides,
  conversationHistory,
}: {
  userPrompt: string;
  foundationContext: DesignWorkbenchFoundationContext;
  componentGuides: DesignWorkbenchComponentGuide[];
  conversationHistory: DesignConversationTurn[];
}): string {
  const parts = [
    'You are an expert product designer generating a UI mock as an image edit.',
    formatFoundationsBlock(foundationContext),
    formatComponentGuidesBlock(componentGuides),
    formatConversationBlock(conversationHistory),
    CANVAS_RULES,
    '## Current user request',
    userPrompt,
  ];
  return parts.filter(Boolean).join('\n\n');
}
