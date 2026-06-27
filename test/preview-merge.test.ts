import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mergePreviews, registryIdFromKey } from '@handoff/transformers/preview/component/preview-merge';

describe('mergePreviews', () => {
  const built = {
    generic: { title: 'Default', values: { Type: 'primary' }, url: 'button-generic.html' },
    secondary: { title: 'Secondary', values: { Type: 'secondary' }, url: 'button-secondary.html' },
  };
  const registry = [
    { id: 'a1', previewKey: 'primary-cta', title: 'Primary CTA', values: { Type: 'primary', Label: 'Go' }, semantic: 'primary', rationale: 'main CTA', syncState: 'in-sync' },
  ];

  it('merges built variants and registry previews into one list, tagged by source', () => {
    const out = mergePreviews(built, registry);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out.map((p) => p.source), ['variant', 'variant', 'registry']);
    assert.deepStrictEqual(out.map((p) => p.key), ['variant:generic', 'variant:secondary', 'registry:a1']);
  });

  it('carries variant url and registry semantic/rationale/syncState', () => {
    const out = mergePreviews(built, registry);
    assert.strictEqual(out[0].url, 'button-generic.html');
    const reg = out.find((p) => p.source === 'registry')!;
    assert.strictEqual(reg.semantic, 'primary');
    assert.strictEqual(reg.rationale, 'main CTA');
    assert.strictEqual(reg.label, 'Primary CTA');
  });

  it('tolerates missing/empty inputs', () => {
    assert.deepStrictEqual(mergePreviews(undefined, undefined), []);
    assert.strictEqual(mergePreviews(built, undefined).length, 2);
    assert.strictEqual(mergePreviews(undefined, registry).length, 1);
  });

  it('registryIdFromKey extracts the id only for registry keys', () => {
    assert.strictEqual(registryIdFromKey('registry:a1'), 'a1');
    assert.strictEqual(registryIdFromKey('variant:generic'), null);
    assert.strictEqual(registryIdFromKey(null), null);
  });
});
