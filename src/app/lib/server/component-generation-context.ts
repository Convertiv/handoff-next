import 'server-only';

import { listReferenceMaterials } from '@/lib/db/queries';
import { getDataProvider } from '@/lib/data';
import { loadHandoffConfigFromDir } from '@/lib/server/handoff-config-load';
import type { handoffDesignArtifacts } from '@/lib/db/schema';

type ArtifactRow = typeof handoffDesignArtifacts.$inferSelect;

export async function loadReferenceMaterialsMarkdown(): Promise<string> {
  const rows = await listReferenceMaterials();
  if (rows.length === 0) {
    return '_(No reference materials generated yet — run Admin → Reference → Regenerate.)_\n';
  }
  const parts: string[] = [];
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`## Reference: ${r.id}\n\n${r.content}\n`);
  }
  return parts.join('\n');
}

export async function buildFoundationContextBlock(artifact: ArtifactRow): Promise<string> {
  const ctx = artifact.foundationContext;
  if (!ctx || typeof ctx !== 'object') return '';
  return `\n## Foundation snapshot (from design artifact)\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2).slice(0, 12000)}\n\`\`\`\n`;
}

export async function pickSimilarComponentExamples(opts: {
  artifact: ArtifactRow;
  maxExamples: number;
}): Promise<{ id: string; title: string; snippet: string }[]> {
  const provider = getDataProvider();
  const list = (await provider.getComponents()) as {
    id: string;
    title?: string;
    group?: string | null;
    data?: unknown;
  }[];

  const guideIds = new Set<string>();
  const guides = Array.isArray(opts.artifact.componentGuides) ? opts.artifact.componentGuides : [];
  for (const g of guides) {
    if (g && typeof g === 'object' && typeof (g as { id?: string }).id === 'string') {
      guideIds.add((g as { id: string }).id);
    }
  }

  const picked: { id: string; title: string; snippet: string }[] = [];
  for (const id of guideIds) {
    const row = list.find((c) => c.id === id);
    if (row) {
      picked.push({
        id: row.id,
        title: row.title || row.id,
        snippet: summarizeComponentSources(row.data),
      });
    }
    if (picked.length >= opts.maxExamples) return picked;
  }

  const title = (opts.artifact.title || '').toLowerCase();
  const scored = list
    .filter((c) => !picked.some((p) => p.id === c.id))
    .map((c) => ({
      c,
      score: (c.title || '').toLowerCase().includes(title.slice(0, 8)) && title.length > 3 ? 2 : c.group ? 1 : 0,
    }))
    .sort((a, b) => b.score - a.score);

  for (const { c } of scored) {
    picked.push({ id: c.id, title: c.title || c.id, snippet: summarizeComponentSources(c.data) });
    if (picked.length >= opts.maxExamples) break;
  }

  return picked.slice(0, opts.maxExamples);
}

function summarizeComponentSources(data: unknown): string {
  if (!data || typeof data !== 'object') return '_no data_';
  const d = data as Record<string, unknown>;
  const es = d.entrySources;
  const parts: string[] = [];
  if (es && typeof es === 'object') {
    for (const [k, v] of Object.entries(es as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        parts.push(`### entrySources.${k}\n\n\`\`\`\n${v.trim().slice(0, 6000)}\n\`\`\`\n`);
      }
    }
  }
  if (typeof d.renderer === 'string') parts.unshift(`renderer: ${d.renderer}\n`);
  return parts.join('\n') || '_empty entrySources_';
}

/**
 * Discover the SCSS preamble / import pattern used by existing project components.
 * Reads the entrySources.scss from all DB-backed components and extracts the most
 * common leading import lines, so the LLM can replicate the project's convention.
 */
export async function discoverScssImportPattern(): Promise<string> {
  const provider = getDataProvider();
  const list = (await provider.getComponents()) as {
    id: string;
    data?: unknown;
  }[];

  const preambles = new Map<string, number>();

  for (const c of list) {
    const d = c.data as Record<string, unknown> | undefined;
    if (!d) continue;
    const es = d.entrySources as Record<string, unknown> | undefined;
    if (!es) continue;
    const scss = typeof es.scss === 'string' ? es.scss.trim() : '';
    if (!scss) continue;

    const lines = scss.split('\n');
    const importBlock: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('@import') || t.startsWith('@use') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/') || t === '') {
        importBlock.push(line);
      } else {
        break;
      }
    }
    if (importBlock.length > 0) {
      const key = importBlock.join('\n').trim();
      preambles.set(key, (preambles.get(key) ?? 0) + 1);
    }
  }

  if (preambles.size === 0) return '';

  const sorted = [...preambles.entries()].sort((a, b) => b[1] - a[1]);
  const [topPreamble, count] = sorted[0];

  if (count < 2 && list.length > 3) return '';

  return topPreamble;
}

/**
 * Build a single-line SCSS import from `handoff.config` `entries.scss` (e.g.
 * `integration/sass/main.scss` → `@import "~/integration/sass/main.scss";`).
 */
export function scssPreambleFromConfigEntry(scssEntry: string): string {
  const raw = scssEntry.trim();
  if (!raw || /^https?:\/\//i.test(raw)) return '';
  const oneLine = raw.replace(/\s+/g, ' ');
  if (oneLine.startsWith('@import ') || oneLine.startsWith('@use ')) {
    return oneLine.endsWith(';') ? oneLine : `${oneLine};`;
  }
  let p = raw.replace(/^\.\//, '').replace(/\\/g, '/');
  if (!p) return '';
  if (p.startsWith('~/')) return `@import "${p}";`;
  return `@import "~/${p}";`;
}

/** Cold-start fallback when no DB components define an import preamble yet. */
export function discoverScssEntryFromConfig(workingDir: string): string {
  const loaded = loadHandoffConfigFromDir(workingDir);
  const scss = loaded?.config?.entries?.scss?.trim();
  if (!scss) return '';
  return scssPreambleFromConfigEntry(scss);
}
