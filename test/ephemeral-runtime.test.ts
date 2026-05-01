import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import type Handoff from '../src/index.js';
import { getEphemeralRuntimePath } from '../src/app-builder/paths.js';
import { EPHEMERAL_RUNTIME_SOURCE_GUARD } from '../src/app-builder/build.js';

describe('ephemeral runtime contract', () => {
  it('getEphemeralRuntimePath matches .handoff/runtime under workingPath', () => {
    const h = { workingPath: '/repo/design' } as Pick<Handoff, 'workingPath'> as Handoff;
    const p = getEphemeralRuntimePath(h);
    assert.strictEqual(p, path.resolve('/repo/design', '.handoff', 'runtime'));
  });

  it('exposes a stable guardrail message for generated runtime', () => {
    assert.match(EPHEMERAL_RUNTIME_SOURCE_GUARD, /\.handoff\/runtime/);
    assert.match(EPHEMERAL_RUNTIME_SOURCE_GUARD, /gitignore/i);
  });
});
