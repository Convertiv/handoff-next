import 'server-only';

import { getDataProvider } from '@/lib/data';

/**
 * A compact, prompt-sized view of the registry's real tokens.
 *
 * Distinct from the MCP `collectFoundationTokens` payload, which is shaped for a client to
 * consume programmatically and is far too large to paste into a spec prompt. Here we only need
 * enough for a vision model to answer "is this observed value one of ours?" — a name, the
 * resolved value, and the reference a developer would actually type.
 */
export interface TokenSummaryEntry {
  name: string;
  value: string;
  /** What a developer writes in code: `var(--…)`, a sass var, or a DTCG path. */
  reference: string;
}

export interface TokenSummary {
  colors: TokenSummaryEntry[];
  typography: TokenSummaryEntry[];
  spacing: TokenSummaryEntry[];
  radii: TokenSummaryEntry[];
}

type AnyRecord = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Cap each list so a large system can't blow the prompt budget. */
const MAX_PER_GROUP = 60;

function summarizeColors(localStyles: AnyRecord): TokenSummaryEntry[] {
  const list = Array.isArray(localStyles.color) ? (localStyles.color as AnyRecord[]) : [];
  return list.slice(0, MAX_PER_GROUP).map((c) => ({
    name: str(c.name),
    value: str(c.value),
    reference: str(c.reference) || str(c.sass) || str(c.machineName),
  }));
}

function summarizeTypography(localStyles: AnyRecord): TokenSummaryEntry[] {
  const list = Array.isArray(localStyles.typography) ? (localStyles.typography as AnyRecord[]) : [];
  return list.slice(0, MAX_PER_GROUP).map((t) => {
    const v = (t.values ?? {}) as AnyRecord;
    const size = str(v.fontSize);
    const lh = str(v.lineHeightPx);
    const parts = [str(v.fontFamily), str(v.fontWeight), size && lh ? `${size}/${lh}` : size].filter(Boolean);
    return {
      name: str(t.name),
      value: parts.join(' '),
      reference: str(t.reference) || str(t.machine_name) || str(t.machineName),
    };
  });
}

/** Walk a DTCG tree to its `$value` leaves, mirroring the MCP flattener. */
function flattenDtcgLeaves(node: unknown, path: string[], out: TokenSummaryEntry[]): void {
  if (!node || typeof node !== 'object' || out.length >= MAX_PER_GROUP) return;
  const obj = node as AnyRecord;
  if ('$value' in obj) {
    out.push({ name: path.join('.'), value: str(obj.$value), reference: `var(--${path.join('-')})` });
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue;
    flattenDtcgLeaves(v, [...path, k], out);
  }
}

/**
 * Spacing and radius live in the DTCG pipeline, not the Figma localStyles snapshot, so they
 * need a separate read — and `getDtcgTokenStrings` returns serialized formats
 * (`{css, scss, tailwind, dtcg}`), so the token tree has to be parsed out of `.dtcg`.
 * Returns [] when the registry has no DTCG dimension tokens — several registries don't
 * (per the SSC notes: color/typography/effect only), and that must not be an error.
 */
async function summarizeDimension(type: 'spacing' | 'border-radius'): Promise<TokenSummaryEntry[]> {
  try {
    const strings = await getDataProvider().getDtcgTokenStrings(type);
    if (!strings?.dtcg) return [];
    const out: TokenSummaryEntry[] = [];
    flattenDtcgLeaves(JSON.parse(strings.dtcg), [], out);
    return out;
  } catch {
    return [];
  }
}

/**
 * Build the token summary for a spec prompt. Never throws — a registry with no tokens yields
 * empty lists, and the caller degrades to "no token mapping available" rather than failing the
 * whole dev handoff.
 */
export async function getTokenSummary(): Promise<TokenSummary> {
  let localStyles: AnyRecord = {};
  try {
    const doc = (await getDataProvider().getTokens()) as AnyRecord | null;
    localStyles = ((doc ?? {}).localStyles ?? {}) as AnyRecord;
  } catch {
    localStyles = {};
  }

  const [spacing, radii] = await Promise.all([summarizeDimension('spacing'), summarizeDimension('border-radius')]);

  return {
    colors: summarizeColors(localStyles),
    typography: summarizeTypography(localStyles),
    spacing,
    radii,
  };
}

/** True when there is nothing to match against — callers should skip the token section entirely. */
export function isTokenSummaryEmpty(s: TokenSummary): boolean {
  return !s.colors.length && !s.typography.length && !s.spacing.length && !s.radii.length;
}

/** Render the summary as compact prompt text. */
export function formatTokenSummaryForPrompt(s: TokenSummary): string {
  const section = (label: string, entries: TokenSummaryEntry[]): string => {
    if (!entries.length) return '';
    const lines = entries.map((e) => `- ${e.name} = ${e.value}${e.reference ? `  → ${e.reference}` : ''}`);
    return `\n### ${label}\n${lines.join('\n')}`;
  };
  return (
    section('Colors', s.colors) +
    section('Typography', s.typography) +
    section('Spacing', s.spacing) +
    section('Border radius', s.radii)
  );
}
