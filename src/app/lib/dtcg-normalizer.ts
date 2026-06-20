/**
 * Converts a DTCG token tree into localStyles-compatible arrays consumed by
 * ColorGrid, TypographyExample, and the effects display.
 *
 * Handles two structural shapes:
 *
 * Shape 1 (migrate-legacy / Figma-sourced):
 *   { color: { group: { machineName: { $type, $value, $description, $extensions.handoff } } } }
 *
 * Shape 2 (CSS brand / resolvet):
 *   { groupName: { key: { $type, $value, $description: varName, $extensions.handoff.brand } } }
 *
 * The normalizer walks the tree recursively, collecting leaves by $type, and
 * reconstructs IColorObject / ITypographyObject / IEffectObject from whatever
 * metadata is present — falling back to conventions when $extensions are absent.
 */

import type { Types as CoreTypes } from 'handoff-core';

type DtcgTree = Record<string, unknown>;

// ── Internal helpers ────────────────────────────────────────────────────────

function humanize(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface DtcgLeaf {
  $type: string;
  $value: unknown;
  $description?: string;
  $extensions?: {
    handoff?: {
      id?: string;
      sass?: string;
      reference?: string;
      blend?: string;
      brand?: string;
      source?: string;
      figmaColor?: string;
      fontStyle?: string;
    };
  };
}

function isLeaf(node: unknown): node is DtcgLeaf {
  return (
    typeof node === 'object' &&
    node !== null &&
    '$type' in (node as object) &&
    '$value' in (node as object)
  );
}

/** Recursively walk a DTCG tree, calling cb for each leaf with its path. */
function walkLeaves(
  node: unknown,
  path: string[],
  cb: (leaf: DtcgLeaf, path: string[]) => void
): void {
  if (!node || typeof node !== 'object') return;
  if (isLeaf(node)) {
    cb(node, path);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!key.startsWith('$')) {
      walkLeaves(value, [...path, key], cb);
    }
  }
}

// ── Color normalizer ─────────────────────────────────────────────────────────

function leafToColorObject(leaf: DtcgLeaf, path: string[]): CoreTypes.IColorObject {
  const ext = leaf.$extensions?.handoff;

  // Shape 1 has a leading 'color' segment; drop it so groups are consistent.
  const cleanPath = path[0] === 'color' ? path.slice(1) : path;

  const group = cleanPath[0] ?? 'misc';
  const subgroup = cleanPath.length > 2 ? cleanPath[1] : null;

  // Prefer metadata from $extensions when present (Shape 1 / migrate-legacy).
  const machineName = ext?.reference
    ? ext.reference.replace(/^--/, '')
    : cleanPath.join('-');

  const reference = ext?.reference ?? `--${machineName}`;
  const sass = ext?.sass ?? `$${machineName}`;
  const id = ext?.id ?? machineName;
  const name =
    leaf.$description && !leaf.$description.startsWith('--')
      ? leaf.$description
      : humanize(cleanPath.join(' '));
  const blend = ext?.blend ?? null;

  return {
    id,
    name,
    machineName,
    value: typeof leaf.$value === 'string' ? leaf.$value : null,
    blend,
    group,
    subgroup,
    groups: cleanPath,
    sass,
    reference,
  };
}

export function dtcgToColors(
  dtcg: DtcgTree,
  brands?: Record<string, DtcgTree>
): CoreTypes.IColorObject[] {
  const seen = new Set<string>();
  const results: CoreTypes.IColorObject[] = [];

  function collect(tree: DtcgTree) {
    walkLeaves(tree, [], (leaf, path) => {
      if (leaf.$type !== 'color') return;
      if (typeof leaf.$value !== 'string') return;
      const obj = leafToColorObject(leaf, path);
      if (!seen.has(obj.machineName)) {
        seen.add(obj.machineName);
        results.push(obj);
      }
    });
  }

  collect(dtcg);
  if (brands) {
    for (const brandTree of Object.values(brands)) {
      collect(brandTree);
    }
  }

  return results;
}

// ── Typography normalizer ────────────────────────────────────────────────────

function leafToTypographyObject(leaf: DtcgLeaf, path: string[]): CoreTypes.ITypographyObject | null {
  const v = leaf.$value as Record<string, unknown>;
  if (!v || typeof v !== 'object') return null;

  const ext = leaf.$extensions?.handoff;

  const cleanPath = path[0] === 'typography' ? path.slice(1) : path;
  const group = cleanPath[0] ?? 'misc';

  const machineName = ext?.reference
    ? ext.reference.replace(/^--/, '')
    : cleanPath.join('-');

  const reference = ext?.reference ?? `--${machineName}`;
  const id = ext?.id ?? machineName;
  const name =
    leaf.$description && !leaf.$description.startsWith('--')
      ? leaf.$description
      : humanize(cleanPath.join(' '));

  // fontSize is stored as "16px" string; TypographyExample needs it as a number.
  const fontSizeRaw = v.fontSize;
  const fontSize =
    typeof fontSizeRaw === 'number'
      ? fontSizeRaw
      : typeof fontSizeRaw === 'string'
      ? parseFloat(fontSizeRaw)
      : undefined;

  // lineHeight is stored as a ratio (1.5); TypographyExample uses lineHeightPx = ratio * fontSize.
  const lineHeightRaw = v.lineHeight;
  const lineHeightRatio =
    typeof lineHeightRaw === 'number' ? lineHeightRaw : undefined;
  const lineHeightPx =
    lineHeightRatio !== undefined && fontSize !== undefined
      ? Math.round(lineHeightRatio * fontSize * 100) / 100
      : undefined;

  return {
    id,
    name,
    machine_name: machineName,
    group,
    reference,
    values: {
      fontFamily: v.fontFamily,
      fontWeight: v.fontWeight,
      fontSize,
      lineHeightPx,
      letterSpacing: v.letterSpacing,
      fontStyle: ext?.fontStyle,
      color: ext?.figmaColor,
    },
  };
}

export function dtcgToTypography(
  dtcg: DtcgTree,
  brands?: Record<string, DtcgTree>
): CoreTypes.ITypographyObject[] {
  const seen = new Set<string>();
  const results: CoreTypes.ITypographyObject[] = [];

  function collect(tree: DtcgTree) {
    walkLeaves(tree, [], (leaf, path) => {
      if (leaf.$type !== 'typography') return;
      const obj = leafToTypographyObject(leaf, path);
      if (!obj || seen.has(obj.machine_name)) return;
      seen.add(obj.machine_name);
      results.push(obj);
    });
  }

  collect(dtcg);
  if (brands) {
    for (const brandTree of Object.values(brands)) {
      collect(brandTree);
    }
  }

  return results;
}

// ── Effect normalizer ────────────────────────────────────────────────────────

function leafToEffectObject(leaf: DtcgLeaf, path: string[]): CoreTypes.IEffectObject | null {
  const ext = leaf.$extensions?.handoff;
  const cleanPath = path[0] === 'shadow' ? path.slice(1) : path;
  const group = cleanPath[0] ?? 'misc';

  const machineName = ext?.reference
    ? ext.reference.replace(/^--/, '')
    : cleanPath.join('-');

  const reference = ext?.reference ?? `--${machineName}`;
  const id = ext?.id ?? machineName;
  const name =
    leaf.$description && !leaf.$description.startsWith('--')
      ? leaf.$description
      : humanize(cleanPath.join(' '));

  const value = leaf.$value;
  const layers = Array.isArray(value) ? value : value ? [value] : [];
  const effects = layers.map((layer: unknown) => {
    const l = layer as Record<string, unknown>;
    const parts = [
      l.offsetX ?? '0px',
      l.offsetY ?? '0px',
      l.blur ?? '0px',
      l.spread ?? '0px',
      l.color ?? '#000000',
    ].join(' ');
    const isInset = Boolean(l.inset);
    return {
      type: (isInset ? 'DROP_SHADOW_INSET' : 'DROP_SHADOW') as CoreTypes.IEffectObject['effects'][number]['type'],
      value: isInset ? `inset ${parts}` : parts,
    };
  });

  return { id, name, machineName, group, effects, reference };
}

export function dtcgToEffects(
  dtcg: DtcgTree,
  brands?: Record<string, DtcgTree>
): CoreTypes.IEffectObject[] {
  const seen = new Set<string>();
  const results: CoreTypes.IEffectObject[] = [];

  function collect(tree: DtcgTree) {
    walkLeaves(tree, [], (leaf, path) => {
      if (leaf.$type !== 'shadow') return;
      const obj = leafToEffectObject(leaf, path);
      if (!obj || seen.has(obj.machineName)) return;
      seen.add(obj.machineName);
      results.push(obj);
    });
  }

  collect(dtcg);
  if (brands) {
    for (const brandTree of Object.values(brands)) {
      collect(brandTree);
    }
  }

  return results;
}

// ── Top-level entry point ────────────────────────────────────────────────────

export interface DtcgNormalized {
  color: CoreTypes.IColorObject[];
  typography: CoreTypes.ITypographyObject[];
  effect: CoreTypes.IEffectObject[];
}

/**
 * Converts a full DTCG registry payload (dtcg tree + optional brands map)
 * into localStyles-compatible arrays. Used to populate visual foundation
 * displays when localStyles.color/typography/effect are empty.
 */
export function normalizeDtcgToLocalStyles(
  dtcg: Record<string, unknown>,
  brands?: Record<string, Record<string, unknown>>
): DtcgNormalized {
  return {
    color: dtcgToColors(dtcg, brands),
    typography: dtcgToTypography(dtcg, brands),
    effect: dtcgToEffects(dtcg, brands),
  };
}
