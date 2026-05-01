#!/usr/bin/env node
/**
 * Append .js to relative import specifiers in dist/ when missing (Node ESM).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');

const SKIP = /\.(js|json|cjs|mjs|wasm|node)$/;

function fixSpec(spec) {
  if (!spec.startsWith('.') && !spec.startsWith('..')) return spec;
  if (SKIP.test(spec)) return spec;
  return `${spec}.js`;
}

function fixContent(s) {
  let out = s;
  out = out.replace(/\bfrom\s+(['"])(\.\.?[^'"]+)\1/g, (m, q, spec) => {
    const n = fixSpec(spec);
    return n === spec ? m : `from ${q}${n}${q}`;
  });
  out = out.replace(/\bimport\s*\(\s*(['"])(\.\.?[^'"]+)\1\s*\)/g, (m, q, spec) => {
    const n = fixSpec(spec);
    return n === spec ? m : `import(${q}${n}${q})`;
  });
  return out;
}

function walk(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name);
    if (n.isDirectory()) walk(p);
    else if (n.name.endsWith('.js')) {
      const t = fs.readFileSync(p, 'utf8');
      const u = fixContent(t);
      if (u !== t) fs.writeFileSync(p, u, 'utf8');
    }
  }
}

if (fs.existsSync(dist)) walk(dist);
console.log('fix-dist-esm-imports: done');
