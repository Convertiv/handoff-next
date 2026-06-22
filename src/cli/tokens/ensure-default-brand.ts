/**
 * Ensures at least one brand exists in design-system/tokens/brands/ so that
 * ColorsDisplay always has brand-structured data to render.
 *
 * Run after transformTokens (which writes tokens.resolved.json).  If the
 * brands/ directory already contains at least one *.tokens.json, this is a
 * no-op.  Otherwise it synthesises a "default" brand by:
 *
 *   1. Reading design-system/dist/dtcg/tokens.resolved.json.
 *   2. Extracting every top-level group under "color".
 *   3. Flattening one extra level of nesting (e.g. primitive.green → a group
 *      named "primitive-green") so ColorsDisplay's two-level renderer sees all
 *      individual swatches.
 *   4. Writing design-system/tokens/brands/default.tokens.json.
 *   5. Adding "brands": ["default"] to design-system/manifest.json (merged,
 *      never replacing an existing brands array).
 */

import path from 'path';
import fs from 'fs-extra';
import { Logger } from '@handoff/utils/logger';

type TokenLeaf = { $type: string; $value: unknown; $description?: string };
type TokenGroup = Record<string, TokenLeaf | Record<string, TokenLeaf>>;
type BrandFile  = Record<string, TokenGroup>;

function isLeaf(val: unknown): val is TokenLeaf {
  return (
    typeof val === 'object' &&
    val !== null &&
    '$value' in (val as Record<string, unknown>)
  );
}

/**
 * Convert one top-level color group into one or more brand groups.
 * - If all children are leaf tokens → one group keyed as `groupName`.
 * - If children are sub-groups → flatten to `groupName-subName` entries.
 */
function colorGroupToBrandEntries(
  groupName: string,
  groupVal: Record<string, unknown>,
): Array<[string, TokenGroup]> {
  // Check whether the direct children are all leaf tokens.
  const childValues = Object.values(groupVal);
  const allLeaves = childValues.every(isLeaf);

  if (allLeaves) {
    return [[groupName, groupVal as TokenGroup]];
  }

  // Children are sub-groups — flatten one level.
  const entries: Array<[string, TokenGroup]> = [];
  for (const [subName, subVal] of Object.entries(groupVal)) {
    if (typeof subVal !== 'object' || subVal === null) continue;
    const flatKey = `${groupName}-${subName}`;
    entries.push([flatKey, subVal as TokenGroup]);
  }
  return entries;
}

export async function ensureDefaultBrand(workingPath: string): Promise<void> {
  const dsRoot    = path.join(workingPath, 'design-system');
  const brandsDir = path.join(dsRoot, 'tokens', 'brands');

  // No-op if any brand file already exists.
  if (await fs.pathExists(brandsDir)) {
    const existing = (await fs.readdir(brandsDir)).filter((f) => f.endsWith('.tokens.json'));
    if (existing.length > 0) return;
  }

  const resolvedPath = path.join(dsRoot, 'dist', 'dtcg', 'tokens.resolved.json');
  if (!(await fs.pathExists(resolvedPath))) {
    Logger.warn('ensureDefaultBrand: tokens.resolved.json not found — skipping default brand generation.');
    return;
  }

  const resolved: Record<string, unknown> = await fs.readJson(resolvedPath);
  const colorGroup = resolved['color'];

  if (!colorGroup || typeof colorGroup !== 'object') {
    Logger.warn('ensureDefaultBrand: no "color" group found in resolved tokens — skipping.');
    return;
  }

  const brand: BrandFile = {};
  for (const [groupName, groupVal] of Object.entries(colorGroup as Record<string, unknown>)) {
    if (typeof groupVal !== 'object' || groupVal === null || isLeaf(groupVal)) continue;
    const entries = colorGroupToBrandEntries(groupName, groupVal as Record<string, unknown>);
    for (const [key, val] of entries) {
      brand[key] = val;
    }
  }

  if (Object.keys(brand).length === 0) {
    Logger.warn('ensureDefaultBrand: no color groups found — skipping default brand generation.');
    return;
  }

  await fs.mkdirp(brandsDir);
  const brandPath = path.join(brandsDir, 'default.tokens.json');
  await fs.writeJson(brandPath, brand, { spaces: 2 });
  Logger.info(`ensureDefaultBrand: generated ${path.relative(workingPath, brandPath)} (${Object.keys(brand).length} groups)`);

  // Patch manifest.json to add brands: ["default"] if not already present.
  const manifestPath = path.join(dsRoot, 'manifest.json');
  if (await fs.pathExists(manifestPath)) {
    const manifest = await fs.readJson(manifestPath);
    if (!Array.isArray(manifest.brands) || manifest.brands.length === 0) {
      manifest.brands = ['default'];
      await fs.writeJson(manifestPath, manifest, { spaces: 2 });
      Logger.info('ensureDefaultBrand: updated manifest.json with brands: ["default"]');
    }
  }
}
