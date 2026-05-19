#!/usr/bin/env node
/**
 * Post-tsc fixes for Node ESM in dist/:
 * 1. Rewrite leftover `@handoff/*` path aliases to relative imports (safety net when tsc-alias did not run).
 * 2. Append `.js` to relative import specifiers when missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');

const SKIP_EXT = /\.(js|json|cjs|mjs|wasm|node)$/;

function resolveHandoffSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('@handoff/')) return specifier;
  const subpath = specifier.slice('@handoff/'.length);
  const base = path.join(dist, subpath);
  const target = fs.existsSync(`${base}.js`) ? `${base}.js` : base.endsWith('.js') ? base : `${base}.js`;
  if (!fs.existsSync(target)) {
    throw new Error(`Cannot resolve "${specifier}" from "${fromFile}" (expected ${target})`);
  }
  const rel = path.relative(path.dirname(fromFile), target);
  const posix = rel.split(path.sep).join('/');
  return `${posix.startsWith('.') ? '' : './'}${posix}`;
}

function fixRelativeExtension(spec) {
  if (!spec.startsWith('.') && !spec.startsWith('..')) return spec;
  if (SKIP_EXT.test(spec)) return spec;
  return `${spec}.js`;
}

function fixContent(filePath, source) {
  const rewrite = (spec) => {
    if (spec.startsWith('@handoff/')) return resolveHandoffSpecifier(filePath, spec);
    return fixRelativeExtension(spec);
  };

  let out = source;
  out = out.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (m, q, spec) => {
    const n = rewrite(spec);
    return n === spec ? m : `from ${q}${n}${q}`;
  });
  out = out.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, spec) => {
    const n = rewrite(spec);
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
      const u = fixContent(p, t);
      if (u !== t) fs.writeFileSync(p, u, 'utf8');
    }
  }
}

const UNRESOLVED_HANDOFF_IMPORT = /\b(?:from|import\s*\()\s*['"]@handoff\//;

function assertNoHandoffImports(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name);
    if (n.isDirectory()) assertNoHandoffImports(p);
    else if (n.name.endsWith('.js')) {
      const t = fs.readFileSync(p, 'utf8');
      if (UNRESOLVED_HANDOFF_IMPORT.test(t)) {
        throw new Error(`Unresolved @handoff import in ${p} — run "npm run build" (full tsc + postprocess).`);
      }
    }
  }
}

if (fs.existsSync(dist)) {
  walk(dist);
  assertNoHandoffImports(dist);
}
console.log('fix-dist-esm-imports: done');
