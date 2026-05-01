import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import type Handoff from '../src/index.js';
import { getEphemeralRuntimePath } from '../src/app-builder/paths.js';

describe('ephemeral runtime contract', () => {
  it('getEphemeralRuntimePath matches .handoff/runtime under workingPath', () => {
    const h = { workingPath: '/repo/design' } as Pick<Handoff, 'workingPath'> as Handoff;
    const p = getEphemeralRuntimePath(h);
    assert.strictEqual(p, path.resolve('/repo/design', '.handoff', 'runtime'));
  });
});
