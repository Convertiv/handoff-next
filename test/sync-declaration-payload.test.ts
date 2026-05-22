import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { evaluateTypeScriptDeclaration } from '../src/config/declaration-module-load.js';
import { normalizeComponentDeclaration } from '../src/config/normalizers/declaration.js';
import { rawToHandoffConfig } from '../src/cli/sync/resolve-declaration-payload.js';
import {
  mergeRemoteMetadataIntoLocalConfig,
  patchHandoffDeclarationSource,
} from '../src/cli/sync/declaration-patch.js';
import {
  buildHandoffDeclarationTsForRenderer,
  inferProjectRenderer,
  nestConfigForDeclarationFile,
} from '../src/declarations/codegen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, 'fixtures/sync-declarations');
const repoRoot = path.join(__dirname, '..');

function loadLegacyJs(filePath: string): Record<string, unknown> {
  const req = createRequire(filePath);
  const resolved = req.resolve(filePath);
  delete req.cache[resolved];
  return req(filePath) as Record<string, unknown>;
}

test('404 legacy js resolves to handlebars sync payload', () => {
  const declPath = path.join(fixturesRoot, '404/404.js');
  const raw = loadLegacyJs(declPath);
  const normalized = normalizeComponentDeclaration(raw, {
    declarationPath: declPath,
    fallbackId: '404',
    warn: () => undefined,
  });
  assert.equal(normalized.id, '404');
  assert.equal(normalized.renderer, 'handlebars');
  assert.ok(normalized.entries?.template);
  const handoffConfig = rawToHandoffConfig(raw, declPath);
  assert.equal(handoffConfig.id, '404');
  assert.equal((handoffConfig.entries as Record<string, string>).template, './template.hbs');
});

test('account_delete handoff.ts evaluates and normalizes as react', () => {
  const declPath = path.join(fixturesRoot, 'account_delete/account_delete.handoff.ts');
  const mod = evaluateTypeScriptDeclaration(declPath, repoRoot) as { default: Record<string, unknown> };
  const raw = mod.default;
  const normalized = normalizeComponentDeclaration(raw, {
    declarationPath: declPath,
    fallbackId: 'account_delete',
    warn: () => undefined,
  });
  assert.equal(normalized.renderer, 'react');
  assert.equal(normalized.title, 'Account delete');
  assert.ok(normalized.properties?.heading);
});

test('patchHandoffDeclarationSource preserves react component import', () => {
  const source = fs.readFileSync(path.join(fixturesRoot, 'account_delete/account_delete.handoff.ts'), 'utf8');
  const local = {
    id: 'account_delete',
    name: 'Account delete',
    description: 'Old',
    group: 'Account',
    type: 'block',
    entries: { component: './AccountDelete.tsx', scss: './styles.scss' },
    previews: { default: { title: 'Default', args: { heading: 'Delete account' } } },
    properties: {},
  };
  const remote = {
    ...local,
    description: 'Updated from remote',
    properties: {
      heading: { name: 'Heading', type: 'text', generic: 'true', default: 'Updated heading' },
    },
  };
  const merged = mergeRemoteMetadataIntoLocalConfig(local, remote, { preserveEntries: true, preserveRenderer: true });
  const patched = patchHandoffDeclarationSource(source, nestConfigForDeclarationFile(merged));
  assert.ok(patched);
  assert.match(patched!, /import AccountDelete from '\.\/AccountDelete'/);
  assert.match(patched!, /Updated from remote/);
  assert.match(patched!, /defineReactComponent\(AccountDelete/);
});

test('synthesized handlebars declaration uses defineHandlebarsComponent', () => {
  const nested = nestConfigForDeclarationFile({
    id: 'new_comp',
    name: 'New',
    renderer: 'handlebars',
    entries: { template: './new_comp.hbs', scss: './new_comp.scss', js: './new_comp.client.js' },
    previews: { default: { title: 'Default', args: {} } },
  });
  const ts = buildHandoffDeclarationTsForRenderer('handlebars', nested);
  assert.match(ts, /defineHandlebarsComponent/);
  assert.match(ts, /new_comp\.hbs/);
});

test('inferProjectRenderer prefers majority renderer', () => {
  const r = inferProjectRenderer(
    {
      a: { renderer: 'react' },
      b: { renderer: 'react' },
      c: { renderer: 'handlebars' },
    },
    'handlebars'
  );
  assert.equal(r, 'react');
});
