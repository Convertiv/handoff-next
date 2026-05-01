#!/usr/bin/env node
/**
 * ESM codemod for root-tsconfig scope (excludes src/app):
 * - Relative imports with `..` -> @handoff/... (no extension; paths map to .ts)
 * - Other relative imports -> add .js for NodeNext
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'src');

const SKIP_EXT = new Set([
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.cjs',
  '.mjs',
  '.wasm',
  '.node',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);

function hasSkippedExtension(spec) {
  const base = path.posix.basename(spec.replace(/\\/g, '/'));
  const i = base.lastIndexOf('.');
  if (i <= 0) return false;
  return SKIP_EXT.has(base.slice(i).toLowerCase());
}

function resolveTargetFile(fromDir, spec) {
  const abs = path.normalize(path.join(fromDir, spec));
  if (fs.existsSync(abs + '.ts')) return abs + '.ts';
  if (fs.existsSync(abs + '.tsx')) return abs + '.tsx';
  if (fs.existsSync(path.join(abs, 'index.ts'))) return path.join(abs, 'index.ts');
  if (fs.existsSync(path.join(abs, 'index.tsx'))) return path.join(abs, 'index.tsx');
  return null;
}

function toHandoff(fromDir, spec) {
  const target = resolveTargetFile(fromDir, spec);
  if (!target) return null;
  const rel = path.relative(srcRoot, target).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return '@handoff/' + rel.replace(/\.tsx?$/i, '');
}

function withJsExtension(fromDir, spec) {
  if (spec.endsWith('.js')) return spec;
  if (hasSkippedExtension(spec)) return spec;
  const target = resolveTargetFile(fromDir, spec);
  if (!target) return spec.endsWith('/') ? `${spec}index.js` : `${spec}.js`;
  const posix = spec.replace(/\\/g, '/');
  if (posix.endsWith('/')) return `${posix}index.js`;
  return `${posix}.js`;
}

function transformFile(absPath) {
  const fromDir = path.dirname(absPath);
  let content = fs.readFileSync(absPath, 'utf8');
  const original = content;

  const mapSpec = (spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('..')) return spec;
    if (spec.includes('..')) {
      const h = toHandoff(fromDir, spec);
      if (h) return h;
    }
    return withJsExtension(fromDir, spec);
  };

  const patterns = [
    /\bfrom\s+(['"])(\.\.?[^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])(\.\.?[^'"]+)\2\s*\)/g,
    /\bexport\s+\*\s+from\s+(['"])(\.\.?[^'"]+)\1/g,
  ];

  for (const re of patterns) {
    content = content.replace(re, (m, q, spec) => {
      const next = mapSpec(spec);
      return m.replace(`${q}${spec}${q}`, `${q}${next}${q}`);
    });
  }

  if (content !== original) {
    fs.writeFileSync(absPath, content, 'utf8');
    return true;
  }
  return false;
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (dir === srcRoot && name.name === 'app') continue;
      walk(p, out);
    } else if (name.isFile() && name.name.endsWith('.ts') && !name.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(srcRoot);
let changed = 0;
for (const f of files) {
  if (transformFile(f)) changed++;
}
console.log(`esm-import-codemod: updated ${changed} files (of ${files.length} scanned)`);
