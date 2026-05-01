import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import { getPathContract } from '../src/app-builder/path-contract.js';
import type { Config } from '../src/types/config.js';

function ctx(overrides: Partial<{ workingPath: string; modulePath: string; config: Config | null }>) {
  return {
    workingPath: '/project/handoff',
    modulePath: '/project/node_modules/handoff-app',
    config: null,
    ...overrides,
  };
}

describe('getPathContract', () => {
  it('defaults to legacy .handoff/app', () => {
    const c = getPathContract(ctx({}));
    assert.strictEqual(c.layout, 'legacy');
    assert.strictEqual(c.appRoot, path.resolve('/project/handoff', '.handoff', 'app'));
  });

  it('honors app.materialization_layout runtime', () => {
    const c = getPathContract(
      ctx({
        config: { app: { materialization_layout: 'runtime' } } as Config,
      })
    );
    assert.strictEqual(c.layout, 'runtime');
    assert.strictEqual(c.appRoot, path.resolve('/project/handoff', 'handoff-runtime'));
  });

  it('forces full strategy when layout is root', () => {
    const c = getPathContract(
      ctx({
        config: { app: { materialization_layout: 'root', materialization_strategy: 'overlay' } } as Config,
      })
    );
    assert.strictEqual(c.layout, 'root');
    assert.strictEqual(c.strategy, 'full');
    assert.strictEqual(c.appRoot, path.resolve('/project/handoff'));
  });
});
