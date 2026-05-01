import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';

/**
 * Unit-test the `resolveAbsoluteFromApp` logic from next.config.mjs.
 * We inline the function here rather than importing the .mjs (which has side effects).
 */
const resolveAbsoluteFromApp = (appDir: string, relPath: unknown, fallback = '') => {
  if (relPath === undefined || relPath === null) {
    return fallback;
  }
  if (typeof relPath === 'string' && relPath.startsWith('%HANDOFF_')) {
    return fallback;
  }
  if (relPath === '') {
    return path.resolve(appDir);
  }
  return path.resolve(appDir, relPath as string);
};

describe('resolveAbsoluteFromApp (next.config logic)', () => {
  const appDir = '/project/.handoff/app';

  it('resolves a normal relative path', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, '../..'), path.resolve(appDir, '../..'));
  });

  it('returns fallback for undefined', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, undefined, '/fallback'), '/fallback');
  });

  it('returns fallback for null', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, null, '/fallback'), '/fallback');
  });

  it('returns fallback for unresolved placeholders', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, '%HANDOFF_WORKING_PATH_REL%', '/fallback'), '/fallback');
  });

  it('handles empty string (app root == working root)', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, ''), path.resolve(appDir));
  });

  it('handles "." (same directory)', () => {
    assert.strictEqual(resolveAbsoluteFromApp(appDir, '.'), path.resolve(appDir, '.'));
  });
});
