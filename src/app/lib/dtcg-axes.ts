/**
 * Axis-aware interpretation layer over the DTCG registry payload (P1.6a/b).
 *
 * The registry stores two token artifacts:
 *  - `brands` — resolved literal trees, the back-compat serving/viz cache. A value
 *    is EITHER a flat tree (legacy, single-scheme) OR scheme-nested `{ [scheme]: tree }`.
 *  - `dtcg_source` — a reference-preserving `Types.DtcgSource` with an ordered
 *    `axes[]`; the authoritative multi-axis tree resolved on demand for queries/viz.
 *
 * This module bridges the two: it normalizes `brands` to a brand × scheme matrix
 * (legacy trees read as scheme "default"), and resolves arbitrary axis selectors
 * against a source via handoff-core's `Dtcg.resolveTokens`. Resolution is for
 * query/visualization only — never the hot theme.css path (ADR-001 §2).
 */

import { Dtcg, type Types as CoreTypes } from 'handoff-core';

export const DEFAULT_SCHEME = 'default';
export const BRAND_AXIS = 'brand';
export const SCHEME_AXIS = 'scheme';

type Tree = Record<string, unknown>;

// ── Source introspection ─────────────────────────────────────────────────────

/** Narrow a raw jsonb blob to a usable `DtcgSource`, or `null` when empty/legacy. */
export function asDtcgSource(source: unknown): CoreTypes.DtcgSource | null {
  if (!source || typeof source !== 'object') return null;
  const s = source as Partial<CoreTypes.DtcgSource>;
  const hasAxes = Array.isArray(s.axes) && s.axes.length > 0;
  const hasTokens = s.tokens != null && typeof s.tokens === 'object' && Object.keys(s.tokens).length > 0;
  return hasAxes || hasTokens ? (source as CoreTypes.DtcgSource) : null;
}

/** The named axis from a source (e.g. "brand", "scheme"), or `undefined`. */
export function getAxis(source: CoreTypes.DtcgSource, name: string): CoreTypes.Axis | undefined {
  return source.axes?.find((a) => a.name === name);
}

/** Values for a named axis, or `[]` when the axis is absent. */
export function axisValues(source: CoreTypes.DtcgSource | null, name: string): string[] {
  if (!source) return [];
  return getAxis(source, name)?.values ?? [];
}

/** Scheme-axis values for a source; `["default"]` when there is no scheme axis. */
export function schemeValues(source: CoreTypes.DtcgSource | null): string[] {
  const vals = axisValues(source, SCHEME_AXIS);
  return vals.length ? vals : [DEFAULT_SCHEME];
}

// ── brands → brand × scheme matrix ───────────────────────────────────────────

/**
 * A brand value is scheme-nested iff every top-level key is a known scheme value
 * and it is not itself a DTCG leaf. Legacy trees are keyed by token-group names
 * (color, gray, …), never all ⊆ the scheme set, so they read as scheme "default".
 * `knownSchemes` comes from the source's scheme axis; without a source there are
 * no schemes and everything is legacy.
 */
function isSchemeNested(value: Tree, knownSchemes: string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0 || '$type' in value) return false;
  if (knownSchemes.length === 0) return false;
  return keys.every((k) => knownSchemes.includes(k));
}

/**
 * Normalize the `brands` column into a `{ [brand]: { [scheme]: tree } }` matrix.
 * Legacy flat trees are placed under scheme "default". `knownSchemes` (from the
 * source's scheme axis) disambiguates nested vs flat; omit it for pure-legacy data.
 */
export function toAxisAwareBrands(
  brands: Record<string, Tree>,
  knownSchemes: string[] = []
): Record<string, Record<string, Tree>> {
  const out: Record<string, Record<string, Tree>> = {};
  for (const [brand, value] of Object.entries(brands ?? {})) {
    if (value && typeof value === 'object' && isSchemeNested(value, knownSchemes)) {
      out[brand] = value as Record<string, Tree>;
    } else {
      out[brand] = { [DEFAULT_SCHEME]: (value ?? {}) as Tree };
    }
  }
  return out;
}

/** The schemes actually present for a brand in an axis-aware brands matrix. */
export function schemesForBrand(matrix: Record<string, Record<string, Tree>>, brand: string): string[] {
  return Object.keys(matrix[brand] ?? {});
}

// ── Resolution against a source (query/viz only) ─────────────────────────────

/**
 * Resolve a source to a literal tree for a (partial) axis selector. Returns the
 * resolved `DtcgGroup` (today's per-brand shape), or `null` on any resolver error
 * (missing reference / cycle) so callers can fall back to the `brands` cache.
 */
export function resolveSelector(
  source: CoreTypes.DtcgSource,
  selector: CoreTypes.AxisSelector
): CoreTypes.DtcgGroup | null {
  try {
    return Dtcg.resolveTokens(source, selector);
  } catch {
    return null;
  }
}

/**
 * Precompute the resolved brand × scheme cache written to the `brands` column on
 * commit (P1.6c) — `{ [brand]: { [scheme]: literalTree } }`. Keeps the serving/viz
 * path reading a flat resolved cache (ADR-001) rather than resolving per request.
 * Sources with no brand axis produce a single "default" brand; a resolver error
 * for a combo drops that cell rather than failing the whole commit.
 */
export function buildResolvedBrandsCache(
  source: CoreTypes.DtcgSource
): Record<string, Record<string, CoreTypes.DtcgGroup>> {
  const brands = axisValues(source, BRAND_AXIS);
  const schemes = schemeValues(source);
  const brandList = brands.length ? brands : [DEFAULT_SCHEME];
  const hasBrandAxis = brands.length > 0;

  const out: Record<string, Record<string, CoreTypes.DtcgGroup>> = {};
  for (const brand of brandList) {
    out[brand] = {};
    for (const scheme of schemes) {
      const selector: CoreTypes.AxisSelector = { [SCHEME_AXIS]: scheme };
      if (hasBrandAxis) selector[BRAND_AXIS] = brand;
      const resolved = resolveSelector(source, selector);
      if (resolved) out[brand][scheme] = resolved;
    }
    if (Object.keys(out[brand]).length === 0) delete out[brand];
  }
  return out;
}
