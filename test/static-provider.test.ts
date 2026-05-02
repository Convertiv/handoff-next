import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import fs from 'fs-extra';

/**
 * Mirror `getPublicApiDir` from `src/app/lib/data/static-provider.ts` for unit tests
 * (avoid importing the real module — it pulls in the full Next util graph).
 */
function getPublicApiDir(): string {
  const appRoot = process.env.HANDOFF_APP_ROOT?.trim();
  if (appRoot && !appRoot.startsWith('%HANDOFF_')) {
    return path.resolve(appRoot, 'public', 'api');
  }
  const working = process.env.HANDOFF_WORKING_PATH?.trim();
  if (working && !working.startsWith('%HANDOFF_')) {
    return path.resolve(working, 'public', 'api');
  }
  const mod = process.env.HANDOFF_MODULE_PATH?.trim();
  const id = process.env.HANDOFF_PROJECT_ID?.trim();
  if (mod && id && !mod.startsWith('%HANDOFF_') && !id.startsWith('%HANDOFF_')) {
    const legacy = path.resolve(mod, '.handoff', id, 'public', 'api');
    if (fs.existsSync(legacy)) return legacy;
  }
  const cwd = process.cwd();
  return path.resolve(cwd, '.handoff', 'app', 'public', 'api');
}

const savedEnv: Record<string, string | undefined> = {};

function saveAndClear(...keys: string[]) {
  for (const k of keys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('getPublicApiDir', () => {
  beforeEach(() => {
    saveAndClear('HANDOFF_APP_ROOT', 'HANDOFF_WORKING_PATH', 'HANDOFF_MODULE_PATH', 'HANDOFF_PROJECT_ID');
  });

  afterEach(() => {
    restoreEnv();
  });

  it('prefers HANDOFF_APP_ROOT/public/api when set', () => {
    process.env.HANDOFF_APP_ROOT = '/runtime/.handoff/runtime';
    process.env.HANDOFF_WORKING_PATH = '/repo/design';
    assert.strictEqual(getPublicApiDir(), path.resolve('/runtime/.handoff/runtime', 'public', 'api'));
  });

  it('uses HANDOFF_WORKING_PATH when HANDOFF_APP_ROOT unset', () => {
    process.env.HANDOFF_WORKING_PATH = '/repo/design';
    assert.strictEqual(getPublicApiDir(), path.resolve('/repo/design', 'public', 'api'));
  });

  it('ignores placeholder values for HANDOFF_APP_ROOT', () => {
    process.env.HANDOFF_APP_ROOT = '%HANDOFF_APP_ROOT%';
    process.env.HANDOFF_WORKING_PATH = '/repo/design';
    assert.strictEqual(getPublicApiDir(), path.resolve('/repo/design', 'public', 'api'));
  });

  it('ignores placeholder values for HANDOFF_WORKING_PATH', () => {
    process.env.HANDOFF_WORKING_PATH = '%HANDOFF_WORKING_PATH_REL%';
    assert.strictEqual(getPublicApiDir(), path.resolve(process.cwd(), '.handoff', 'app', 'public', 'api'));
  });

  it('trims whitespace from env vars', () => {
    process.env.HANDOFF_WORKING_PATH = '  /repo/design  ';
    assert.strictEqual(getPublicApiDir(), path.resolve('/repo/design', 'public', 'api'));
  });
});
