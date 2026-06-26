/**
 * MCP quality harness — pure coverage scorer (Phase E2 core).
 *
 * "Quality" = does an AI response actually use the registry's real design system?
 * The scorer is deliberately heuristic (coverage, not exact match): for each
 * expected *kind* of marker, does the response contain at least one real marker
 * of that kind drawn from the live registry ground truth?
 *
 * No I/O, no server deps — safe to unit-test and to import from the runner.
 */

export type ExpectKind =
  | 'brandColor' // a real color value or color token name
  | 'tokenName' // any token name / CSS variable
  | 'spacingVar' // a --spacing-* variable specifically
  | 'componentId' // a real component id
  | 'iconName' // a real icon id/name
  | 'brandPrinciple'; // a key brand-voice term

/** Real values pulled from the live registry at run time (lowercased by buildGroundTruth). */
export interface GroundTruth {
  colorValues: string[]; // hex / rgb strings, e.g. "#0077c8"
  colorNames: string[]; // sass/reference/machineName, e.g. "$color-primary-ssc-blue"
  cssVariables: string[]; // "--color-*", "--spacing-*", "--border-radius-*"
  componentIds: string[];
  iconNames: string[];
  brandTerms: string[]; // distinctive brand-voice phrases
}

export interface GoldenPrompt {
  id: string;
  category: 'token' | 'component' | 'icon' | 'brand';
  prompt: string;
  /** Marker kinds the response should evidence. Coverage = matched / expected. */
  expect: ExpectKind[];
}

export interface PromptScore {
  id: string;
  matched: ExpectKind[];
  missed: ExpectKind[];
  coverage: number;
}

const MIN_MARKER_LEN = 3; // avoid trivial substring false-positives

function markersForKind(kind: ExpectKind, gt: GroundTruth): string[] {
  switch (kind) {
    case 'brandColor':
      return [...gt.colorValues, ...gt.colorNames];
    case 'tokenName':
      return [...gt.colorNames, ...gt.cssVariables];
    case 'spacingVar':
      return gt.cssVariables.filter((v) => v.startsWith('--spacing'));
    case 'componentId':
      return gt.componentIds;
    case 'iconName':
      return gt.iconNames;
    case 'brandPrinciple':
      return gt.brandTerms;
    default:
      return [];
  }
}

/** Score one response against its expected marker kinds. */
export function scoreResponse(response: string, expect: ExpectKind[], gt: GroundTruth): Omit<PromptScore, 'id'> {
  const hay = response.toLowerCase();
  const matched: ExpectKind[] = [];
  const missed: ExpectKind[] = [];
  for (const kind of expect) {
    const markers = markersForKind(kind, gt)
      .map((m) => m.toLowerCase())
      .filter((m) => m.length >= MIN_MARKER_LEN);
    const hit = markers.some((m) => hay.includes(m));
    (hit ? matched : missed).push(kind);
  }
  const coverage = expect.length ? matched.length / expect.length : 1;
  return { matched, missed, coverage };
}

export interface Aggregate {
  total: number;
  passed: number; // prompts at 100% coverage
  meanCoverage: number; // 0..1 across all prompts
}

export function aggregate(scores: PromptScore[]): Aggregate {
  const total = scores.length;
  const passed = scores.filter((s) => s.coverage >= 1).length;
  const meanCoverage = total ? scores.reduce((a, s) => a + s.coverage, 0) / total : 1;
  return { total, passed, meanCoverage };
}

/** Build lowercased ground truth from raw MCP tool payloads. Tolerant of missing pieces. */
export function buildGroundTruth(input: {
  tokens?: unknown;
  components?: unknown;
  icons?: unknown;
  brandVoice?: unknown;
}): GroundTruth {
  const gt: GroundTruth = {
    colorValues: [],
    colorNames: [],
    cssVariables: [],
    componentIds: [],
    iconNames: [],
    brandTerms: [],
  };

  const tokens = input.tokens as
    | { colors?: { value?: string; sass?: string; reference?: string; machineName?: string }[]; spacing?: { cssVariable?: string }[]; borderRadius?: { cssVariable?: string }[]; grid?: { cssVariable?: string }[] }
    | undefined;
  if (tokens) {
    for (const c of tokens.colors ?? []) {
      if (typeof c.value === 'string') gt.colorValues.push(c.value);
      for (const n of [c.sass, c.reference, c.machineName]) if (typeof n === 'string' && n) gt.colorNames.push(n);
      if (typeof c.reference === 'string') gt.cssVariables.push(`--${c.reference}`);
    }
    for (const dim of [...(tokens.spacing ?? []), ...(tokens.borderRadius ?? []), ...(tokens.grid ?? [])]) {
      if (typeof dim.cssVariable === 'string') gt.cssVariables.push(dim.cssVariable);
    }
  }

  const components = input.components as { id?: string }[] | undefined;
  for (const c of components ?? []) if (typeof c?.id === 'string') gt.componentIds.push(c.id);

  const icons = input.icons as { name?: string; id?: string }[] | undefined;
  for (const i of icons ?? []) for (const n of [i?.name, i?.id]) if (typeof n === 'string' && n) gt.iconNames.push(n);

  const bv = input.brandVoice as { brandVoice?: { voiceTone?: string } } | undefined;
  const tone = bv?.brandVoice?.voiceTone;
  if (typeof tone === 'string') {
    // distinctive single words from the tone statement (length >= 5)
    gt.brandTerms.push(...tone.split(/[^a-zA-Z]+/).filter((w) => w.length >= 5));
  }

  // lowercase + de-dupe everything
  for (const k of Object.keys(gt) as (keyof GroundTruth)[]) {
    gt[k] = Array.from(new Set(gt[k].map((s) => s.toLowerCase())));
  }
  return gt;
}
