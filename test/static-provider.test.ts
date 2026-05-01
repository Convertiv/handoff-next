import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import fs from 'fs-extra';

/**
 * Mirror the `getPublicApiDir` logic from `src/app/lib/data/static-provider.ts`
 * so we can test path resolution without pulling in the full Next.js module graph.
 */
function getPublicApiDir(): string {
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
  return path.resolve(process.cwd(), 'public', 'api');
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
    saveAndClear('HANDOFF_WORKING_PATH', 'HANDOFF_MODULE_PATH', 'HANDOFF_PROJECT_ID');
  });

  afterEach(() => {
    restoreEnv();
  });

  it('uses HANDOFF_WORKING_PATH/public/api when set', () => {
    process.env.HANDOFF_WORKING_PATH = '/repo/design';
    assert.strictEqual(getPublicApiDir(), path.resolve('/repo/design', 'public', 'api'));
  });

  it('ignores placeholder values for HANDOFF_WORKING_PATH', () => {
    process.env.HANDOFF_WORKING_PATH = '%HANDOFF_WORKING_PATH_REL%';
    assert.strictEqual(getPublicApiDir(), path.resolve(process.cwd(), 'public', 'api'));
  });

  it('falls back to cwd/public/api when no env vars set', () => {
    assert.strictEqual(getPublicApiDir(), path.resolve(process.cwd(), 'public', 'api'));
  });

  it('trims whitespace from env vars', () => {
    process.env.HANDOFF_WORKING_PATH = '  /repo/design  ';
    assert.strictEqual(getPublicApiDir(), path.resolve('/repo/design', 'public', 'api'));
  });
});
