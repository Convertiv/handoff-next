/**
 * Migrates a legacy Handoff token snapshot (IDocumentationObject) into the
 * canonical DTCG 2025.10 token tree under design-system/tokens/.
 *
 * Source: exported/tokens.json  (written by `handoff-app fetch`)
 * Output:
 *   design-system/tokens/primitive/color.tokens.json
 *   design-system/tokens/primitive/shadow.tokens.json
 *   design-system/tokens/semantic/typography.tokens.json
 *   design-system/manifest.json  (updated with Figma-sourced counts)
 *
 * Hand-authored files already present under design-system/tokens/ are
 * preserved and included in the manifest — they are never overwritten.
 */

import fs from 'fs-extra';
import path from 'path';
import { Types as HandoffTypes } from 'handoff-core';
import Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

interface DtcgToken {
  $type: string;
  $value: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

type DtcgTree = { [key: string]: DtcgTree | DtcgToken };

interface MigrationResult {
  colorCount: number;
  typographyCount: number;
  shadowCount: number;
  manualCounts: Record<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function setPath(root: DtcgTree, keys: string[], leaf: DtcgToken): void {
  let node: DtcgTree = root;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!node[keys[i]] || typeof (node[keys[i]] as DtcgToken).$type !== 'undefined') {
      node[keys[i]] = {};
    }
    node = node[keys[i]] as DtcgTree;
  }
  node[keys[keys.length - 1]] = leaf;
}

function envelope(originalId: string, extra: Record<string, unknown> = {}) {
  return { handoff: { source: 'figma', originalId, syncState: 'in-sync', ...extra } };
}

function countLeafTokens(tree: unknown): number {
  if (!tree || typeof tree !== 'object') return 0;
  const obj = tree as Record<string, unknown>;
  if ('$value' in obj) return 1;
  return Object.values(obj).reduce<number>((n, v) => n + countLeafTokens(v), 0);
}

function collectTokenFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTokenFiles(full));
    else if (entry.name.endsWith('.tokens.json')) files.push(full);
  }
  return files;
}

// ── Color ──────────────────────────────────────────────────────────────────

function buildColors(colors: HandoffTypes.IColorObject[]): { tree: DtcgTree; count: number } {
  const tree: DtcgTree = {};
  for (const c of colors) {
    const group = c.group || 'misc';
    const key = String(c.machineName || c.reference);
    setPath(tree, ['color', group, key], {
      $type: 'color',
      $value: c.value,
      $description: c.name,
      $extensions: envelope(c.id, {
        sass: c.sass,
        reference: c.reference,
        ...(c.blend && c.blend !== 'normal' ? { blend: c.blend } : {}),
      }),
    });
  }
  return { tree, count: colors.length };
}

// ── Typography ─────────────────────────────────────────────────────────────

function buildTypography(types: HandoffTypes.ITypographyObject[]): { tree: DtcgTree; count: number } {
  const tree: DtcgTree = {};
  for (const t of types) {
    const v = (t.values || {}) as Record<string, unknown>;
    const fontSize = typeof v.fontSize === 'number' ? v.fontSize : undefined;
    const lineHeightPx = typeof v.lineHeightPx === 'number' ? v.lineHeightPx : undefined;
    const lineHeight = fontSize && lineHeightPx
      ? Math.round((lineHeightPx / fontSize) * 10000) / 10000
      : undefined;
    const letterSpacing = typeof v.letterSpacing === 'number'
      ? `${Math.round(v.letterSpacing * 10000) / 10000}px`
      : undefined;

    const composite: Record<string, unknown> = {
      fontFamily: v.fontFamily,
      fontWeight: v.fontWeight,
      ...(fontSize !== undefined ? { fontSize: `${fontSize}px` } : {}),
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
    };
    Object.keys(composite).forEach((k) => composite[k] === undefined && delete composite[k]);

    const group = t.group || 'misc';
    setPath(tree, ['typography', group, (t as unknown as Record<string, string>).machine_name || t.reference], {
      $type: 'typography',
      $value: composite,
      $description: t.name,
      $extensions: envelope(t.id, {
        reference: t.reference,
        ...(v.color ? { figmaColor: v.color } : {}),
        ...(v.fontStyle ? { fontStyle: v.fontStyle } : {}),
      }),
    });
  }
  return { tree, count: types.length };
}

// ── Shadow ─────────────────────────────────────────────────────────────────

function parseShadowLayer(cssValue: string, isInset: boolean) {
  const colorMatch = cssValue.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|hsla?\([^)]*\))/i);
  const color = colorMatch ? colorMatch[0].replace(/\s+/g, '') : '#000000';
  const rest = (colorMatch ? cssValue.replace(colorMatch[0], '') : cssValue)
    .replace(/inset/i, '')
    .trim();
  const [offsetX = '0px', offsetY = '0px', blur = '0px', spread = '0px'] = rest.split(/\s+/).filter(Boolean);
  return { color, offsetX, offsetY, blur, spread, ...(isInset ? { inset: true } : {}) };
}

function buildShadows(effects: HandoffTypes.IEffectObject[]): { tree: DtcgTree; count: number } {
  const tree: DtcgTree = {};
  for (const e of effects) {
    const layers = ((e.effects || []) as Array<{ value: string; type: string }>).map((fx) =>
      parseShadowLayer(fx.value, /INNER/i.test(fx.type))
    );
    const value = layers.length === 1 ? layers[0] : layers;
    const key = (e.machineName || e.reference).replace(/^effect-shadow-/, '');
    setPath(tree, ['shadow', key], {
      $type: 'shadow',
      $value: value,
      $description: e.name,
      $extensions: envelope(e.id, {
        reference: e.reference,
        rawValue: ((e.effects || []) as Array<{ value: string }>).map((fx) => fx.value).join(', '),
      }),
    });
  }
  return { tree, count: effects.length };
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function migrateLegacyTokens(handoff: Handoff): Promise<MigrationResult> {
  const workingPath = handoff.workingPath;
  const tokensPath  = handoff.getTokensFilePath();

  if (!(await fs.pathExists(tokensPath))) {
    throw new Error(
      `No tokens.json found at ${path.relative(workingPath, tokensPath)}. Run \`handoff-app fetch\` first.`
    );
  }

  const doc = await fs.readJson(tokensPath) as HandoffTypes.IDocumentationObject;
  const localStyles = doc.localStyles;
  if (!localStyles) {
    throw new Error('tokens.json is missing localStyles — cannot migrate.');
  }

  const dsRoot    = path.join(workingPath, 'design-system');
  const tokensOut = path.join(dsRoot, 'tokens');
  const primitiveOut = path.join(tokensOut, 'primitive');
  const semanticOut  = path.join(tokensOut, 'semantic');

  await fs.ensureDir(primitiveOut);
  await fs.ensureDir(semanticOut);

  const projectId = handoff.config?.figma_project_id ?? handoff.getProjectId() ?? 'unknown';

  const colorResult = buildColors(localStyles.color ?? []);
  const typoResult  = buildTypography(localStyles.typography ?? []);
  const shadowResult = buildShadows(localStyles.effect ?? []);

  const figmaFiles = new Set([
    path.join(primitiveOut, 'color.tokens.json'),
    path.join(primitiveOut, 'shadow.tokens.json'),
    path.join(semanticOut, 'typography.tokens.json'),
  ]);

  await Promise.all([
    fs.writeJson(path.join(primitiveOut, 'color.tokens.json'), colorResult.tree, { spaces: 2 }),
    fs.writeJson(path.join(primitiveOut, 'shadow.tokens.json'), shadowResult.tree, { spaces: 2 }),
    fs.writeJson(path.join(semanticOut, 'typography.tokens.json'), typoResult.tree, { spaces: 2 }),
  ]);

  // Scan for hand-authored files not written by this function
  const manualCounts: Record<string, number> = {};
  const manualPrimitivePaths: string[] = [];
  const manualSemanticPaths: string[] = [];

  if (await fs.pathExists(tokensOut)) {
    for (const f of collectTokenFiles(tokensOut)) {
      if (figmaFiles.has(f)) continue;
      const rel = path.relative(dsRoot, f).replace(/\\/g, '/');
      const tree = await fs.readJson(f);
      const topKey = Object.keys(tree)[0];
      if (topKey) manualCounts[topKey] = countLeafTokens(tree[topKey]);
      if (rel.startsWith('tokens/primitive')) manualPrimitivePaths.push(rel);
      else if (rel.startsWith('tokens/semantic')) manualSemanticPaths.push(rel);
    }
  }

  const extraTotal = Object.values(manualCounts).reduce((s, v) => s + v, 0);
  const now = new Date().toISOString();

  const manifest = {
    project: projectId,
    generatedAt: now,
    generator: 'handoff-app tokens:build',
    tiers: {
      primitive: ['tokens/primitive/color.tokens.json', 'tokens/primitive/shadow.tokens.json', ...manualPrimitivePaths],
      semantic: ['tokens/semantic/typography.tokens.json', ...manualSemanticPaths],
    },
    counts: {
      color: colorResult.count,
      typography: typoResult.count,
      shadow: shadowResult.count,
      ...manualCounts,
      total: colorResult.count + typoResult.count + shadowResult.count + extraTotal,
    },
    sources: [`figma:${projectId}`],
  };

  await fs.writeJson(path.join(dsRoot, 'manifest.json'), manifest, { spaces: 2 });

  Logger.info(`  color:      ${colorResult.count}`);
  Logger.info(`  typography: ${typoResult.count}`);
  Logger.info(`  shadow:     ${shadowResult.count}`);
  if (Object.keys(manualCounts).length > 0) {
    for (const [type, count] of Object.entries(manualCounts)) {
      Logger.info(`  ${type.padEnd(12)}${count} (hand-authored)`);
    }
  }

  return { colorCount: colorResult.count, typographyCount: typoResult.count, shadowCount: shadowResult.count, manualCounts };
}
