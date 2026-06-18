/**
 * Parses brand CSS files (theme.css + brands/*.css) into DTCG token files.
 *
 * Handles:
 *  - Raw values:   --var: #hex / rem / px
 *  - Aliases:      --var: var(--other)  →  resolved to final value
 *  - @theme inline blocks: skipped (derivative Tailwind mappings)
 *
 * Output files per brand:
 *   design-system/tokens/shared/gray.tokens.json
 *   design-system/tokens/brands/{brand}.tokens.json
 */

import fs from 'fs-extra';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrandTokenFile {
  brand: string;
  filePath: string;
}

interface ParsedVars {
  [varName: string]: string; // --var-name → raw or resolved value
}

interface DtcgLeaf {
  $type: string;
  $value: string | number;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

// ── CSS parsing ────────────────────────────────────────────────────────────

const THEME_BLOCK_RE  = /@theme[^{]*\{[^}]*\}/gs;
const UTILITY_BLOCK_RE = /@utility[^{]*\{[\s\S]*?\n\}/g;
const AT_RULE_RE      = /@(?:layer|variant|apply)[^;{]*[;{][^}]*\}?/g;
const ROOT_BLOCK_RE   = /:root\s*\{([^}]*)\}/gs;
const VAR_DECL_RE     = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REF_RE      = /^var\(--([a-zA-Z0-9_-]+)\)$/;

function stripNonRootBlocks(css: string): string {
  return css
    .replace(THEME_BLOCK_RE, '')
    .replace(UTILITY_BLOCK_RE, '')
    .replace(AT_RULE_RE, '');
}

function extractRootVars(css: string): ParsedVars {
  const vars: ParsedVars = {};
  const stripped = stripNonRootBlocks(css);
  let match: RegExpExecArray | null;
  ROOT_BLOCK_RE.lastIndex = 0;
  while ((match = ROOT_BLOCK_RE.exec(stripped)) !== null) {
    const block = match[1];
    VAR_DECL_RE.lastIndex = 0;
    let decl: RegExpExecArray | null;
    while ((decl = VAR_DECL_RE.exec(block)) !== null) {
      vars[`--${decl[1]}`] = decl[2].trim();
    }
  }
  return vars;
}

/** Resolve aliases transitively. Cycles are broken after 10 hops. */
function resolveVars(vars: ParsedVars, baseVars?: ParsedVars): ParsedVars {
  const pool = { ...(baseVars ?? {}), ...vars };
  const resolved: ParsedVars = {};

  for (const [name, raw] of Object.entries(vars)) {
    let value = raw;
    for (let i = 0; i < 10; i++) {
      const ref = VAR_REF_RE.exec(value);
      if (!ref) break;
      const target = `--${ref[1]}`;
      if (!pool[target]) break;
      value = pool[target];
    }
    resolved[name] = value;
  }

  return resolved;
}

// ── Token type inference ───────────────────────────────────────────────────

const SHADCN_SEMANTIC_ROLES = new Set([
  'background', 'foreground', 'card', 'card-foreground',
  'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
]);

function inferType(name: string, value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value)) return 'color';
  if (/rem$|em$/.test(value)) return 'dimension';
  if (/px$/.test(value)) return 'dimension';
  return 'color'; // default for brand files — almost everything is color
}

function tokenGroup(varName: string): { group: string; key: string; semantic: boolean } {
  // --hagyard-navy-500 → group: hagyard-navy, key: 500
  // --resolvet-blue-50 → group: resolvet-blue, key: 50
  // --gray-100 → group: gray, key: 100
  // --primary → group: semantic, key: primary (shadcn role)
  // --navy → group: semantic, key: navy

  const bare = varName.replace(/^--/, '');

  if (SHADCN_SEMANTIC_ROLES.has(bare) || bare === 'navy' || bare.startsWith('surface-') ||
      bare.startsWith('mosaic-') || bare.startsWith('cta-card-')) {
    return { group: 'semantic', key: bare, semantic: true };
  }

  // layout tokens
  if (bare.startsWith('layout-')) {
    return { group: 'layout', key: bare.replace('layout-', ''), semantic: false };
  }

  // ramp tokens: {brand-name}-{step} e.g. resolvet-blue-50, gray-100
  const rampMatch = bare.match(/^(.+)-(\d+(?:\.\d+)?)$/);
  if (rampMatch) {
    return { group: rampMatch[1], key: rampMatch[2], semantic: false };
  }

  return { group: 'misc', key: bare, semantic: false };
}

// ── DTCG tree builder ──────────────────────────────────────────────────────

function buildDtcgTree(
  vars: ParsedVars,
  brandTag: string | null,
): Record<string, unknown> {
  const tree: Record<string, Record<string, DtcgLeaf>> = {};

  for (const [varName, value] of Object.entries(vars)) {
    if (!value || value.startsWith('var(')) continue; // unresolved alias — skip

    const { group, key } = tokenGroup(varName);
    const type = inferType(varName, value);

    if (!tree[group]) tree[group] = {};
    const leaf: DtcgLeaf = {
      $type: type,
      $value: value,
      $description: varName,
    };

    if (brandTag) {
      leaf.$extensions = { handoff: { brand: brandTag, source: 'css' } };
    }

    tree[group][key] = leaf;
  }

  return tree;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface BrandCssConfig {
  /** Path to the shared theme.css (gray ramp + Tailwind wiring) */
  sharedCss: string;
  /** Per-brand CSS files to parse */
  brands: BrandTokenFile[];
  /** Workspace root — output goes to design-system/tokens/ */
  workingPath: string;
}

export async function parseCssBrands(config: BrandCssConfig): Promise<Record<string, number>> {
  const { workingPath, sharedCss, brands } = config;
  const counts: Record<string, number> = {};

  // 1. Parse shared theme vars (used as base for alias resolution)
  const sharedCssContent = await fs.readFile(sharedCss, 'utf-8');
  const sharedRaw  = extractRootVars(sharedCssContent);
  const sharedVars = resolveVars(sharedRaw);

  // Emit shared gray ramp
  const sharedOut = path.join(workingPath, 'design-system', 'tokens', 'shared');
  await fs.ensureDir(sharedOut);

  const grayVars = Object.fromEntries(
    Object.entries(sharedVars).filter(([k]) => k.startsWith('--gray-'))
  );
  const grayTree = buildDtcgTree(grayVars, null);
  await fs.writeJson(path.join(sharedOut, 'gray.tokens.json'), grayTree, { spaces: 2 });
  counts['shared/gray'] = Object.values(grayVars).length;

  // 2. Parse each brand file — resolve aliases against shared vars
  const brandsOut = path.join(workingPath, 'design-system', 'tokens', 'brands');
  await fs.ensureDir(brandsOut);

  for (const { brand, filePath } of brands) {
    const content  = await fs.readFile(filePath, 'utf-8');
    const brandRaw = extractRootVars(content);
    const resolved = resolveVars(brandRaw, sharedVars);
    const tree     = buildDtcgTree(resolved, brand);

    await fs.writeJson(path.join(brandsOut, `${brand}.tokens.json`), tree, { spaces: 2 });
    counts[brand] = Object.keys(resolved).length;
  }

  return counts;
}
