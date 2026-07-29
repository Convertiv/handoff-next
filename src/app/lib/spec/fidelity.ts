import type { ComponentSpec } from '../server/design-spec-types';

/**
 * Round-trip fidelity between an original specification and the specification derived from a design
 * regenerated from it (spec → prompt → image → spec′).
 *
 * The point is to answer "is the spec sufficient to reconstruct the design?" with a number and a
 * breakdown rather than an impression. A single opaque score would hide the interesting part, so
 * each dimension is reported separately — they answer different questions and fail independently:
 *
 *  - **content** is the most objective signal. Copy either survived verbatim or it did not.
 *  - **tokens** says whether the design landed on the same design-system values.
 *  - **structure** says whether it is even the same *kind* of thing.
 *  - **props** is the weakest signal (naming is model-dependent) and weighted accordingly.
 *
 * Deliberately pure and dependency-free so it can be unit-tested and run from a script.
 */

const norm = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().toLowerCase() : '');

/** |A ∩ B| / |A ∪ B|. Returns null when both sides are empty — nothing to measure, not a failure. */
function jaccard(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? null : inter / union;
}

/** Share of `expected` that survived into `actual`. Asymmetric on purpose: loss matters, extras don't. */
function recall(expected: Set<string>, actual: Set<string>): number | null {
  if (expected.size === 0) return null;
  let found = 0;
  for (const v of expected) if (actual.has(v)) found += 1;
  return found / expected.size;
}

export interface FidelityDimension {
  dimension: 'content' | 'tokens' | 'structure' | 'props';
  /** 0–1, or null when there was nothing to compare. */
  score: number | null;
  weight: number;
  detail: string;
}

export interface SpecFidelity {
  /** Weighted mean of the scorable dimensions, 0–1. */
  score: number;
  dimensions: FidelityDimension[];
  /** Copy present in the original that did not survive the round trip — the most useful output. */
  lostCopy: string[];
  /** Copy in the regenerated design that the original never had, i.e. invention. */
  inventedCopy: string[];
}

export function specFidelity(before: ComponentSpec, after: ComponentSpec): SpecFidelity {
  // ── content ──────────────────────────────────────────────────────────────
  const beforeCopy = new Set((before.content?.textInventory ?? []).map((t) => norm(t.text)).filter(Boolean));
  const afterCopy = new Set((after.content?.textInventory ?? []).map((t) => norm(t.text)).filter(Boolean));
  const contentScore = recall(beforeCopy, afterCopy);

  const lostCopy = (before.content?.textInventory ?? [])
    .filter((t) => norm(t.text) && !afterCopy.has(norm(t.text)))
    .map((t) => t.text);
  const inventedCopy = (after.content?.textInventory ?? [])
    .filter((t) => norm(t.text) && !beforeCopy.has(norm(t.text)))
    .map((t) => t.text);

  // ── tokens ───────────────────────────────────────────────────────────────
  // Compare the token NAMES landed on, not the observed values: two runs can render the same token
  // a pixel apart, and it is the design-system decision we care about.
  const tokenNames = (s: ComponentSpec): Set<string> => {
    const out = new Set<string>();
    const t = s.tokens;
    if (!t) return out;
    for (const group of [t.colors, t.typography, t.spacing, t.radii]) {
      for (const r of group ?? []) if (r.token) out.add(norm(r.token));
    }
    return out;
  };
  const tokenScore = jaccard(tokenNames(before), tokenNames(after));

  // ── structure ────────────────────────────────────────────────────────────
  const structureChecks: { ok: boolean; label: string }[] = [
    { ok: norm(before.overview?.type) === norm(after.overview?.type), label: 'type' },
    { ok: norm(before.overview?.designSystemGroup) === norm(after.overview?.designSystemGroup), label: 'group' },
    { ok: (before.variants?.length ?? 0) === (after.variants?.length ?? 0), label: 'variant count' },
  ];
  const structureScore = structureChecks.filter((c) => c.ok).length / structureChecks.length;

  // ── props ────────────────────────────────────────────────────────────────
  const propNames = (s: ComponentSpec) => new Set((s.props ?? []).map((p) => norm(p.name)).filter(Boolean));
  const propScore = jaccard(propNames(before), propNames(after));

  const dimensions: FidelityDimension[] = [
    {
      dimension: 'content',
      score: contentScore,
      weight: 0.5,
      detail:
        contentScore === null
          ? 'No copy in the original to compare.'
          : `${beforeCopy.size - lostCopy.length}/${beforeCopy.size} copy strings survived; ${inventedCopy.length} invented.`,
    },
    {
      dimension: 'tokens',
      score: tokenScore,
      weight: 0.25,
      detail: tokenScore === null ? 'No token mapping on either side.' : `Token overlap ${Math.round(tokenScore * 100)}%.`,
    },
    {
      dimension: 'structure',
      score: structureScore,
      weight: 0.15,
      detail: structureChecks.map((c) => `${c.label}: ${c.ok ? 'match' : 'differs'}`).join(', '),
    },
    {
      dimension: 'props',
      score: propScore,
      weight: 0.1,
      detail: propScore === null ? 'No props on either side.' : `Prop-name overlap ${Math.round(propScore * 100)}%.`,
    },
  ];

  const scorable = dimensions.filter((d) => d.score !== null);
  const totalWeight = scorable.reduce((n, d) => n + d.weight, 0);
  const score = totalWeight === 0 ? 0 : scorable.reduce((n, d) => n + (d.score as number) * d.weight, 0) / totalWeight;

  return { score, dimensions, lostCopy, inventedCopy };
}
