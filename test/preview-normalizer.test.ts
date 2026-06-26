import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizePreviews } from '@handoff/transformers/preview/component/normalizer';

describe('normalizePreviews', () => {
  it('converts a legacy keyed-map to an array, using the key as id', () => {
    const out = normalizePreviews({
      primary: { title: 'Primary', values: { Type: 'primary' } },
      secondary: { title: 'Secondary', values: { Type: 'secondary' } },
    });
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(
      out.map((p) => p.id),
      ['primary', 'secondary']
    );
    assert.strictEqual(out[0].title, 'Primary');
    assert.deepStrictEqual(out[0].values, { Type: 'primary' });
  });

  it('passes an array through, preserving explicit ids', () => {
    const out = normalizePreviews([
      { id: 'a', title: 'A', values: {} },
      { id: 'b', title: 'B', values: {} },
    ]);
    assert.deepStrictEqual(out.map((p) => p.id), ['a', 'b']);
  });

  it('derives an id from the title when none is given (array form)', () => {
    const out = normalizePreviews([{ title: 'Primary — main CTA', values: {} }]);
    assert.strictEqual(out[0].id, 'primary-main-cta');
  });

  it('falls back to preview-N when no id or title', () => {
    const out = normalizePreviews([{ values: {} }, { values: {} }]);
    assert.deepStrictEqual(out.map((p) => p.id), ['preview-1', 'preview-2']);
  });

  it('de-duplicates colliding ids deterministically', () => {
    const out = normalizePreviews([
      { id: 'x', values: {} },
      { id: 'x', values: {} },
      { id: 'x', values: {} },
    ]);
    assert.deepStrictEqual(out.map((p) => p.id), ['x', 'x-2', 'x-3']);
  });

  it('preserves slots, semantic, rationale, and unknown fields', () => {
    const out = normalizePreviews({
      primary: {
        title: 'Primary',
        values: { Type: 'primary' },
        slots: { icon: 'ref' },
        semantic: 'primary',
        rationale: 'main CTA',
        url: '/x',
        custom: 42,
      },
    });
    assert.strictEqual(out[0].semantic, 'primary');
    assert.strictEqual(out[0].rationale, 'main CTA');
    assert.deepStrictEqual(out[0].slots, { icon: 'ref' });
    assert.strictEqual(out[0].url, '/x');
    assert.strictEqual((out[0] as { custom?: number }).custom, 42);
  });

  it('is lenient — never throws, skips junk entries', () => {
    assert.deepStrictEqual(normalizePreviews(undefined), []);
    assert.deepStrictEqual(normalizePreviews(null), []);
    assert.deepStrictEqual(normalizePreviews('nope'), []);
    const out = normalizePreviews([{ id: 'ok', values: {} }, null, 7, 'str', { id: 'ok2', values: {} }]);
    assert.deepStrictEqual(out.map((p) => p.id), ['ok', 'ok2']);
  });

  it('defaults missing values to an empty object and title to the id', () => {
    const out = normalizePreviews({ only: {} });
    assert.deepStrictEqual(out[0].values, {});
    assert.strictEqual(out[0].title, 'only');
  });
});
