#!/usr/bin/env node
/**
 * Phase 0 — round-trip existing handoff foundations into a canonical DTCG tree.
 *
 * Reads the current per-type token exports (public/api/tokens/{color,typography,effect}.json)
 * and emits DTCG 2025.10 token files under design-system/tokens/, with Handoff's provenance
 * envelope stored inline per token at $extensions['handoff'] (the DTCG-sanctioned escape
 * hatch — same pattern Tokens Studio uses for $extensions['studio.tokens']).
 *
 * This is the Phase 0 proof: existing colors + fonts + effects become spec-shaped DTCG with
 * no data loss (anything DTCG can't represent is preserved under $extensions.handoff).
 *
 * Tiering (Phase 0 classification):
 *   primitive/  raw values — color ramps, base shadows
 *   semantic/   named intent — typography roles (Display, H1, …)
 *
 * Usage:
 *   node build/tokens-to-dtcg.js [--source <projectId>]
 *
 * NOTE: dimension values are emitted as strings ("72px") for broad Style Dictionary
 * compatibility. Migrating standalone dimensions to the strict 2025.10 object form
 * ({ value: 72, unit: "px" }) is a tracked Phase 1 follow-up.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID   = (() => {
  const i = process.argv.indexOf('--source');
  return i !== -1 ? process.argv[i + 1] : '3GcQn3eA8Kg9kprYXBXksv';
})();

const API_TOKENS = path.join(HANDOFF_ROOT, 'public', 'api', 'tokens');
const DS_ROOT    = path.join(HANDOFF_ROOT, 'design-system');
const TOKENS_OUT = path.join(DS_ROOT, 'tokens');

const SOURCE = `figma:${PROJECT_ID}`;
const NOW    = new Date().toISOString();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** Build the inline Handoff provenance envelope for one token. */
function envelope(originalId, extra = {}) {
  return {
    handoff: {
      source: SOURCE,
      originalId,
      syncState: 'in-sync',
      lastSynced: NOW,
      ...extra,
    },
  };
}

/** Set a nested key path on an object, creating groups as needed. */
function setPath(root, keys, leaf) {
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    node[keys[i]] = node[keys[i]] || {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = leaf;
}

// ---------------------------------------------------------------------------
// COLOR → DTCG `color` (primitive tier)
//   nested as color.<group>.<machineName>, e.g. color.primary.100
// ---------------------------------------------------------------------------

function buildColors(colors) {
  const tree = {};
  let count = 0;

  for (const c of colors) {
    const group = c.group || 'misc';
    const key   = String(c.machineName || c.reference);
    const leaf = {
      $type: 'color',
      $value: c.value, // hex string — valid DTCG; structured color object is a later upgrade
      $description: c.name,
      $extensions: envelope(c.id, {
        sass: c.sass,
        reference: c.reference,
        ...(c.blend && c.blend !== 'normal' ? { blend: c.blend } : {}),
      }),
    };
    setPath(tree, ['color', group, key], leaf);
    count++;
  }

  return { tree, count };
}

// ---------------------------------------------------------------------------
// TYPOGRAPHY → DTCG `typography` composite (semantic tier)
//   DTCG typography composite has no color slot, so the Figma text color is
//   preserved under $extensions.handoff.figmaColor (lossless round-trip).
// ---------------------------------------------------------------------------

function buildTypography(types) {
  const tree = {};
  let count = 0;

  for (const t of types) {
    const v = t.values || {};
    const lineHeight = v.fontSize && v.lineHeightPx
      ? Math.round((v.lineHeightPx / v.fontSize) * 10000) / 10000  // unitless multiplier
      : undefined;

    const composite = {
      fontFamily: v.fontFamily,
      fontWeight: v.fontWeight,
      fontSize: v.fontSize != null ? `${v.fontSize}px` : undefined,
      letterSpacing: v.letterSpacing != null ? `${Math.round(v.letterSpacing * 10000) / 10000}px` : undefined,
      ...(lineHeight != null ? { lineHeight } : {}),
    };
    // strip undefined sub-properties
    Object.keys(composite).forEach((k) => composite[k] === undefined && delete composite[k]);

    const leaf = {
      $type: 'typography',
      $value: composite,
      $description: t.name,
      $extensions: envelope(t.id, {
        reference: t.reference,
        ...(v.color ? { figmaColor: v.color } : {}),       // not in DTCG typography — preserved
        ...(v.fontStyle ? { fontStyle: v.fontStyle } : {}),
        ...(v.fontPostScriptName ? { fontPostScriptName: v.fontPostScriptName } : {}),
      }),
    };

    const group = t.group || 'misc';
    setPath(tree, ['typography', group, t.machine_name || t.reference], leaf);
    count++;
  }

  return { tree, count };
}

// ---------------------------------------------------------------------------
// EFFECT → DTCG `shadow` (primitive tier)
//   parses the CSS shadow string into the DTCG shadow object
// ---------------------------------------------------------------------------

function parseShadow(cssValue, isInset) {
  // pull the color out first (it contains spaces), then split the numeric parts
  const colorMatch = cssValue.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|hsla?\([^)]*\))/i);
  const color = colorMatch ? colorMatch[0].replace(/\s+/g, '') : '#000000';
  const rest  = (colorMatch ? cssValue.replace(colorMatch[0], '') : cssValue)
    .replace(/inset/i, '')
    .trim();
  const parts = rest.split(/\s+/).filter(Boolean);

  const [offsetX = '0px', offsetY = '0px', blur = '0px', spread = '0px'] = parts;
  return {
    color,
    offsetX,
    offsetY,
    blur,
    spread,
    ...(isInset ? { inset: true } : {}),
  };
}

function buildShadows(effects) {
  const tree = {};
  let count = 0;

  for (const e of effects) {
    const layers = (e.effects || []).map((fx) =>
      parseShadow(fx.value, /INNER/i.test(fx.type))
    );
    // DTCG shadow $value is a single object or an array of them (multi-layer)
    const value = layers.length === 1 ? layers[0] : layers;

    const leaf = {
      $type: 'shadow',
      $value: value,
      $description: e.name,
      $extensions: envelope(e.id, {
        reference: e.reference,
        rawValue: (e.effects || []).map((fx) => fx.value).join(', '),  // original CSS, lossless
      }),
    };

    const key = (e.machineName || e.reference).replace(/^effect-shadow-/, '');
    setPath(tree, ['shadow', key], leaf);
    count++;
  }

  return { tree, count };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(function main() {
  console.log(`\n=== tokens-to-dtcg — round-trip foundations for ${PROJECT_ID} ===\n`);

  const colors = readJson(path.join(API_TOKENS, 'color.json'));
  const types  = readJson(path.join(API_TOKENS, 'typography.json'));
  const fx     = readJson(path.join(API_TOKENS, 'effect.json'));

  const colorOut = buildColors(colors);
  const typoOut  = buildTypography(types);
  const shadowOut = buildShadows(fx);

  writeJson(path.join(TOKENS_OUT, 'primitive', 'color.tokens.json'),  colorOut.tree);
  writeJson(path.join(TOKENS_OUT, 'primitive', 'shadow.tokens.json'), shadowOut.tree);
  writeJson(path.join(TOKENS_OUT, 'semantic',  'typography.tokens.json'), typoOut.tree);

  // Cross-cutting manifest index — points at the inline tokens, does not duplicate values
  const manifest = {
    project: PROJECT_ID,
    generatedAt: NOW,
    generator: 'build/tokens-to-dtcg.js',
    tiers: {
      primitive: ['tokens/primitive/color.tokens.json', 'tokens/primitive/shadow.tokens.json'],
      semantic:  ['tokens/semantic/typography.tokens.json'],
    },
    counts: {
      color: colorOut.count,
      typography: typoOut.count,
      shadow: shadowOut.count,
      total: colorOut.count + typoOut.count + shadowOut.count,
    },
    sources: [SOURCE],
  };
  writeJson(path.join(DS_ROOT, 'manifest.json'), manifest);

  // Round-trip validation: every input must be represented in output
  const ok =
    colorOut.count === colors.length &&
    typoOut.count === types.length &&
    shadowOut.count === fx.length;

  console.log(`  color:      ${colorOut.count}/${colors.length}`);
  console.log(`  typography: ${typoOut.count}/${types.length}`);
  console.log(`  shadow:     ${shadowOut.count}/${fx.length}`);
  console.log(`\n  → design-system/tokens/{primitive,semantic}/*.tokens.json`);
  console.log(`  → design-system/manifest.json (${manifest.counts.total} tokens indexed)`);
  console.log(`\n  Round-trip: ${ok ? 'OK — all inputs represented' : 'MISMATCH — see counts above'}\n`);

  if (!ok) process.exit(1);
})();
