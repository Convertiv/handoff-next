#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '../src');

function mapSpec(dir, spec) {
  if (!spec.endsWith('.js') || (!spec.startsWith('.') && !spec.startsWith('..'))) return spec;
  const absJs = path.normalize(path.join(dir, spec));
  if (fs.existsSync(absJs)) return spec;
  const base = spec.slice(0, -3);
  const idxTs = path.join(dir, base, 'index.ts');
  const idxTsx = path.join(dir, base, 'index.tsx');
  if (fs.existsSync(idxTs) || fs.existsSync(idxTsx)) {
    return base.replace(/\\/g, '/') + '/index.js';
  }
  return spec;
}

function fixFile(absPath) {
  const dir = path.dirname(absPath);
  let s = fs.readFileSync(absPath, 'utf8');
  const orig = s;

  s = s.replace(/\bfrom\s+(['"])(\.\.?[^'"]+)\1/g, (m, q, spec) => {
    const next = mapSpec(dir, spec);
    return next === spec ? m : `from ${q}${next}${q}`;
  });
  s = s.replace(/\bimport\s*\(\s*(['"])(\.\.?[^'"]+)\1\s*\)/g, (m, q, spec) => {
    const next = mapSpec(dir, spec);
    return next === spec ? m : `import(${q}${next}${q})`;
  });

  if (s !== orig) fs.writeFileSync(absPath, s, 'utf8');
}

function walk(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name);
    if (n.isDirectory()) {
      if (d === srcRoot && n.name === 'app') continue;
      if (n.name === 'node_modules') continue;
      walk(p);
    } else if (n.name.endsWith('.ts') && !n.name.endsWith('.d.ts')) {
      fixFile(p);
    }
  }
}

walk(srcRoot);
console.log('fix-index-imports: done');
