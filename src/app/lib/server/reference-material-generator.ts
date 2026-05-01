import 'server-only';

import { getDataProvider } from '@/lib/data';
import { openAiChatJson } from '@/lib/server/ai-client';
import type { ReferenceMaterialId } from '@/lib/server/reference-material-ids';

type ComponentRow = {
  id: string;
  title?: string;
  group?: string | null;
  type?: string | null;
  properties?: unknown;
  previews?: unknown;
  data?: unknown;
};

function countProperties(props: unknown): number {
  if (!props || typeof props !== 'object') return 0;
  return Object.keys(props as Record<string, unknown>).length;
}

function previewKeys(previews: unknown): string[] {
  if (!previews || typeof previews !== 'object') return [];
  return Object.keys(previews as Record<string, unknown>);
}

function hasJsFlag(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const es = d.entrySources;
  if (es && typeof es === 'object') {
    const js = (es as Record<string, unknown>).js;
    if (typeof js === 'string' && js.trim().length > 20) return true;
  }
  return false;
}

export async function generateCatalogMarkdown(): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const provider = getDataProvider();
  const list = (await provider.getComponents()) as ComponentRow[];
  const rows = list
    .slice()
    .sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.id.localeCompare(b.id));

  const byGroup = new Map<string, ComponentRow[]>();
  for (const c of rows) {
    const g = c.group?.trim() || 'Uncategorized';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(c);
  }

  let md = `# Component catalog (generated)\n\n`;
  md += `Total: **${list.length}** components.\n\n`;
  md += `| ID | Title | Type | Props | Previews | JS |\n`;
  md += `| --- | --- | --- | --- | --- | --- |\n`;

  for (const c of rows) {
    const pk = previewKeys(c.previews).join(', ') || '—';
    md += `| \`${c.id}\` | ${escapeMdCell(c.title || '')} | ${escapeMdCell(c.type || '')} | ${countProperties(c.properties)} | ${escapeMdCell(pk)} | ${hasJsFlag(c.data) ? 'Yes' : 'No'} |\n`;
  }

  md += `\n## By group\n\n`;
  for (const [g, cs] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    md += `### ${escapeMdCell(g)}\n\n`;
    for (const c of cs) {
      md += `- **${c.id}** — ${escapeMdCell(c.title || c.id)}\n`;
    }
    md += `\n`;
  }

  return {
    content: md,
    metadata: { componentCount: list.length, generatedKind: 'catalog' },
  };
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
}

function walkTokenLeaves(obj: unknown, prefix: string, out: { path: string; value: string }[], depth = 0): void {
  if (depth > 12) return;
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    out.push({ path: prefix || 'root', value: String(obj) });
    return;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 40).forEach((item, i) => {
      walkTokenLeaves(item, `${prefix}[${i}]`, out, depth + 1);
    });
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      walkTokenLeaves(v, p, out, depth + 1);
    }
  }
}

export async function generateTokensMarkdown(): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const provider = getDataProvider();
  const tokens = (await provider.getTokens()) as Record<string, unknown>;
  const local = (tokens.localStyles as Record<string, unknown>) || {};

  let md = `# Design tokens (generated)\n\n`;
  const sections = ['color', 'typography', 'effect', 'spacing'] as const;
  for (const key of sections) {
    const arr = local[key];
    md += `## ${key}\n\n`;
    if (!Array.isArray(arr) || arr.length === 0) {
      md += `_No entries._\n\n`;
      continue;
    }
    md += `| Name | Value / line |\n| --- | --- |\n`;
    for (const item of arr.slice(0, 200)) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? o.id ?? '');
      const line = String(o.line ?? o.value ?? JSON.stringify(o).slice(0, 120));
      md += `| ${escapeMdCell(name)} | ${escapeMdCell(line)} |\n`;
    }
    md += `\n`;
  }

  const flat: { path: string; value: string }[] = [];
  walkTokenLeaves(tokens, '', flat);
  const cssVars = flat.filter((x) => x.value.includes('var(--') || x.path.toLowerCase().includes('css'));
  md += `## CSS custom properties (sample)\n\n`;
  md += `| Path | Sample value |\n| --- | --- |\n`;
  for (const row of cssVars.slice(0, 80)) {
    md += `| ${escapeMdCell(row.path)} | ${escapeMdCell(row.value.slice(0, 100))} |\n`;
  }

  return {
    content: md,
    metadata: { generatedKind: 'tokens', localStyleKeys: sections.filter((k) => Array.isArray(local[k]) && (local[k] as unknown[]).length > 0) },
  };
}

const FA_CLASS = /\bfa[a-z0-9-]*\s+fa-[a-z0-9-]+\b/gi;
const SVG_TAG = /<svg[\s\S]*?<\/svg>/gi;

function collectTemplateSources(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const es = d.entrySources;
  const parts: string[] = [];
  if (es && typeof es === 'object') {
    for (const v of Object.values(es as Record<string, unknown>)) {
      if (typeof v === 'string') parts.push(v);
    }
  }
  return parts;
}

export async function generateIconsMarkdown(): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const provider = getDataProvider();
  const list = (await provider.getComponents()) as ComponentRow[];
  const faClasses = new Map<string, number>();
  let svgCount = 0;

  for (const c of list) {
    const blobs = collectTemplateSources(c.data);
    for (const blob of blobs) {
      const m = blob.matchAll(FA_CLASS);
      for (const x of m) {
        const cls = x[0].toLowerCase();
        faClasses.set(cls, (faClasses.get(cls) ?? 0) + 1);
      }
      const svgs = blob.match(SVG_TAG);
      if (svgs) svgCount += svgs.length;
    }
  }

  const sorted = [...faClasses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
  let md = `# Icons and icon-like markup (generated)\n\n`;
  md += `Scanned **${list.length}** component template sources.\n\n`;
  md += `## Font Awesome–style classes (frequency)\n\n`;
  if (sorted.length === 0) {
    md += `_None detected._\n\n`;
  } else {
    md += `| Class pattern | Uses |\n| --- | --- |\n`;
    for (const [cls, n] of sorted) {
      md += `| \`${escapeMdCell(cls)}\` | ${n} |\n`;
    }
  }
  md += `\n## Inline SVG\n\nTotal SVG fragments found: **${svgCount}**.\n`;

  return {
    content: md,
    metadata: { generatedKind: 'icons', faDistinct: sorted.length, svgFragments: svgCount },
  };
}

type PropSig = { json: string; count: number; exampleIds: string[] };

function signatureForProperty(name: string, def: unknown): string {
  try {
    return JSON.stringify({ name, shape: simplifyPropShape(def) });
  } catch {
    return JSON.stringify({ name, shape: 'unknown' });
  }
}

function simplifyPropShape(def: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (!def || typeof def !== 'object') return typeof def;
  const o = def as Record<string, unknown>;
  const out: Record<string, unknown> = { type: o.type };
  if (Array.isArray(o.properties)) {
    out.properties = (o.properties as unknown[]).map((p) =>
      p && typeof p === 'object' ? simplifyPropShape(p, depth + 1) : p
    );
  }
  if (o.items && typeof o.items === 'object') out.items = simplifyPropShape(o.items, depth + 1);
  return out;
}

export async function generatePropertyPatternsRawMarkdown(): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const provider = getDataProvider();
  const list = (await provider.getComponents()) as ComponentRow[];
  const sigMap = new Map<string, PropSig>();

  for (const c of list) {
    const props = c.properties;
    if (!props || typeof props !== 'object') continue;
    for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
      const sig = signatureForProperty(name, def);
      const cur = sigMap.get(sig);
      if (!cur) {
        sigMap.set(sig, { json: sig, count: 1, exampleIds: [c.id] });
      } else {
        cur.count += 1;
        if (cur.exampleIds.length < 5 && !cur.exampleIds.includes(c.id)) cur.exampleIds.push(c.id);
      }
    }
  }

  const frequent = [...sigMap.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count);

  let md = `# Property pattern frequency (algorithmic)\n\n`;
  md += `Pairs of property name + structural shape appearing in **2+** components.\n\n`;
  md += `| Occurrences | Example component IDs | Shape (JSON) |\n| --- | --- | --- |\n`;
  for (const row of frequent.slice(0, 120)) {
    md += `| ${row.count} | ${row.exampleIds.map((id) => `\`${id}\``).join(', ')} | \`${escapeMdCell(row.json.slice(0, 240))}\` |\n`;
  }

  return {
    content: md,
    metadata: { generatedKind: 'property-patterns-raw', patternCount: frequent.length },
  };
}

async function refinePropertyPatternsWithLlm(
  rawMarkdown: string,
  opts: { actorUserId?: string | null }
): Promise<string> {
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return `${rawMarkdown}\n\n---\n\n_(LLM refinement skipped: HANDOFF_AI_API_KEY not set.)_\n`;
  }
  const system = `You are a design-system documentation assistant. Given a frequency table of Handoff component property shapes, produce a concise markdown guide with:
- Sections per recurring pattern (heading, CTA, image, link, arrays, toggles, etc.) when inferrable from property names/types
- Copy-paste friendly **JSON snippets** for a single representative property definition (Handoff metadata shape: name, description, type, default, rules)
- Short usage notes for authors implementing new components
Keep under 8000 characters. Respond with JSON only: { "markdown": "<markdown body>" }. Escape newlines in markdown as \\n inside the JSON string.`;

  const user = `Here is the raw frequency analysis:\n\n${rawMarkdown.slice(0, 12000)}`;
  const out = await openAiChatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      actorUserId: opts.actorUserId,
      route: 'reference-material-generator',
      eventType: 'ai.reference_property_patterns',
      model: process.env.HANDOFF_REFERENCE_MODEL?.trim() || 'gpt-4.1-mini',
    }
  );
  try {
    const parsed = JSON.parse(out) as { markdown?: string };
    if (typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
      return parsed.markdown.replace(/\\n/g, '\n');
    }
  } catch {
    /* fall through */
  }
  return typeof out === 'string' && out.trim() ? out.trim() : rawMarkdown;
}

export async function generatePropertyPatternsMarkdown(opts: {
  actorUserId?: string | null;
  skipLlm?: boolean;
}): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const raw = await generatePropertyPatternsRawMarkdown();
  let content = raw.content;
  if (!opts.skipLlm) {
    content = await refinePropertyPatternsWithLlm(content, { actorUserId: opts.actorUserId });
  } else {
    content = `${raw.content}\n\n---\n\n_(LLM refinement skipped.)_\n`;
  }
  return {
    content,
    metadata: { ...raw.metadata, llmRefined: !opts.skipLlm },
  };
}

export async function generateReferenceMaterial(
  id: ReferenceMaterialId,
  opts: { actorUserId?: string | null; skipLlm?: boolean } = {}
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  switch (id) {
    case 'catalog':
      return generateCatalogMarkdown();
    case 'tokens':
      return generateTokensMarkdown();
    case 'icons':
      return generateIconsMarkdown();
    case 'property-patterns':
      return generatePropertyPatternsMarkdown({ actorUserId: opts.actorUserId, skipLlm: opts.skipLlm });
    default:
      throw new Error(`Unknown reference material: ${id}`);
  }
}

export async function generateAllReferenceMaterials(opts: {
  actorUserId?: string | null;
  skipLlm?: boolean;
} = {}): Promise<Record<ReferenceMaterialId, { content: string; metadata: Record<string, unknown> }>> {
  const out = {} as Record<ReferenceMaterialId, { content: string; metadata: Record<string, unknown> }>;
  const ids: ReferenceMaterialId[] = ['catalog', 'tokens', 'icons', 'property-patterns'];
  for (const id of ids) {
    // Property patterns last — may call LLM
    if (id === 'property-patterns') continue;
    out[id] = await generateReferenceMaterial(id, opts);
  }
  out['property-patterns'] = await generateReferenceMaterial('property-patterns', opts);
  return out;
}
