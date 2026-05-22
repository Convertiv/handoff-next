/**
 * Warn when handoff-app is nested under an npm workspace root (causes dependency hoisting bugs).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parentPkg = path.join(repoRoot, '..', 'package.json');

if (!existsSync(parentPkg)) {
  process.exit(0);
}

let parent;
try {
  parent = JSON.parse(readFileSync(parentPkg, 'utf8'));
} catch {
  process.exit(0);
}

const workspaces = parent.workspaces;
if (!Array.isArray(workspaces)) {
  process.exit(0);
}

const pkgName = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).name;
const folderName = path.basename(repoRoot);
const listed =
  workspaces.includes(pkgName) ||
  workspaces.includes(folderName) ||
  workspaces.some((w) => w.endsWith(`/${folderName}`) || w.endsWith(`/${pkgName}`));

if (!listed) {
  process.exit(0);
}

const msg = `
[handoff-app] Parent npm workspace detected at ${parentPkg}

Installing from a workspace root hoists dependencies (e.g. drizzle-kit) outside this repo and breaks
local scripts. handoff-app must be installed on its own — the same layout Vercel uses.

Fix:
  1. Remove "workspaces" from the parent package.json (or delete that file).
  2. Delete the parent node_modules/ and package-lock.json if present.
  3. cd ${repoRoot} && rm -rf node_modules && npm ci

See docs/STANDALONE-INSTALL.md
`;

console.error(msg);
process.exit(1);
