#!/usr/bin/env node
/**
 * Phase 1 — transform canonical DTCG tokens into all default output formats.
 *
 * Input:  design-system/tokens/{primitive,semantic}/*.tokens.json
 * Output: design-system/dist/
 *   css/tokens.css          CSS custom properties  (--color-primary-ssc-blue: …)
 *   scss/_tokens.scss       Sass variables          ($color-primary-ssc-blue: …)
 *   tailwind/theme.css      Tailwind 4 @theme block (@theme { --color-*: … })
 *   dtcg/                   DTCG passthrough        (alias-resolved, spec-compliant)
 *
 * Usage:
 *   node scripts/tokens-transform.js
 */

import StyleDictionary from 'style-dictionary';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const TOKENS_IN = path.join(ROOT, 'design-system', 'tokens');
const DIST_OUT  = path.join(ROOT, 'design-system', 'dist');

// ── Collect all *.tokens.json files from the design-system tree ─────────────

function collectTokenFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTokenFiles(full));
    else if (entry.name.endsWith('.tokens.json')) files.push(full);
  }
  return files;
}

const tokenFiles = collectTokenFiles(TOKENS_IN).map(f => path.relative(ROOT, f));

// ── Custom format: Tailwind 4 @theme block ───────────────────────────────────
// Tailwind 4 is CSS-first — it reads an @theme {} block, not a JS config.
// We emit: @theme { --color-primary-ssc-blue: #0077c8; … }

StyleDictionary.registerFormat({
  name: 'css/tailwind-theme',
  format({ dictionary }) {
    const lines = dictionary.allTokens.map(token => {
      const name = token.name.replace(/_/g, '-');
      const raw  = token.$value;
      const val  = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
      return `  --${name}: ${val};`;
    });
    return `@theme {\n${lines.join('\n')}\n}\n`;
  },
});

// ── Custom format: DTCG passthrough (alias-resolved) ────────────────────────
// Writes back a single merged DTCG file with all aliases resolved to their
// final values — useful as a portable snapshot for any DTCG-capable tool.

StyleDictionary.registerFormat({
  name: 'json/dtcg-resolved',
  format({ dictionary }) {
    const out = {};
    for (const token of dictionary.allTokens) {
      const keys  = token.path;
      let   node  = out;
      for (let i = 0; i < keys.length - 1; i++) {
        node[keys[i]] = node[keys[i]] || {};
        node = node[keys[i]];
      }
      node[keys[keys.length - 1]] = {
        $type:  token.$type,
        $value: token.$value,
        ...(token.$description ? { $description: token.$description } : {}),
        ...(token.$extensions  ? { $extensions:  token.$extensions  } : {}),
      };
    }
    return JSON.stringify(out, null, 2) + '\n';
  },
});

// ── Build ────────────────────────────────────────────────────────────────────

const sd = new StyleDictionary({
  // SD4 accepts DTCG files directly — no parser needed
  source: tokenFiles,
  log: { verbosity: 'silent' },

  platforms: {
    css: {
      transformGroup: 'css',
      prefix: '',
      buildPath: `${path.relative(ROOT, DIST_OUT)}/css/`,
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },

    scss: {
      transformGroup: 'scss',
      prefix: '',
      buildPath: `${path.relative(ROOT, DIST_OUT)}/scss/`,
      files: [{ destination: '_tokens.scss', format: 'scss/variables' }],
    },

    tailwind: {
      transformGroup: 'css',
      prefix: '',
      buildPath: `${path.relative(ROOT, DIST_OUT)}/tailwind/`,
      files: [{ destination: 'theme.css', format: 'css/tailwind-theme' }],
    },

    dtcg: {
      transformGroup: 'js',
      buildPath: `${path.relative(ROOT, DIST_OUT)}/dtcg/`,
      files: [{ destination: 'tokens.resolved.json', format: 'json/dtcg-resolved' }],
    },
  },
});

await sd.buildAllPlatforms();

// ── Summary ──────────────────────────────────────────────────────────────────

const outputs = [
  `${path.relative(ROOT, DIST_OUT)}/css/tokens.css`,
  `${path.relative(ROOT, DIST_OUT)}/scss/_tokens.scss`,
  `${path.relative(ROOT, DIST_OUT)}/tailwind/theme.css`,
  `${path.relative(ROOT, DIST_OUT)}/dtcg/tokens.resolved.json`,
];

console.log('\n=== tokens-transform — Phase 1 output ===\n');
for (const f of outputs) {
  const size = fs.existsSync(f) ? `${Math.round(fs.statSync(f).size / 1024 * 10) / 10} kB` : 'MISSING';
  console.log(`  ${f.padEnd(48)} ${size}`);
}
console.log();
