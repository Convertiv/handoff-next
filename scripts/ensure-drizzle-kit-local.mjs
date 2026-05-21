/**
 * npm workspaces hoist drizzle-kit to the parent Handoff/node_modules, but drizzle-orm
 * stays in handoff-app/node_modules. drizzle-kit migrate/generate then cannot load drizzle-orm.
 * Copy the hoisted package into this project so CLI tools resolve the sibling orm package.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localKitDir = path.join(repoRoot, 'node_modules', 'drizzle-kit');

if (existsSync(path.join(localKitDir, 'bin.cjs'))) {
  process.exit(0);
}

const req = createRequire(path.join(repoRoot, 'package.json'));
let hoistedKitDir;
try {
  hoistedKitDir = path.dirname(req.resolve('drizzle-kit/bin.cjs'));
} catch {
  console.warn('[handoff-app] drizzle-kit not installed; skip local copy');
  process.exit(0);
}

mkdirSync(path.join(repoRoot, 'node_modules'), { recursive: true });
cpSync(hoistedKitDir, localKitDir, { recursive: true });
console.log('[handoff-app] drizzle-kit copied to node_modules/ (workspace hoisting workaround)');
