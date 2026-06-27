import assert from 'node:assert';
import { describe, it } from 'node:test';
import { validatePreviewValues, slugifyPreviewKey } from '@handoff/transformers/preview/component/preview-validation';

const contract = {
  Type: { enum: ['primary', 'secondary', 'tertiary'] },
  Label: { rules: { content: { min: 5, max: 60 } } },
  URL: {},
};

describe('validatePreviewValues', () => {
  it('passes valid values', () => {
    assert.deepStrictEqual(validatePreviewValues({ Type: 'primary', Label: 'Request a demo' }, contract), []);
  });

  it('flags an unknown property', () => {
    const errs = validatePreviewValues({ Nope: 'x' }, contract);
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].key, 'Nope');
  });

  it('flags an out-of-enum value', () => {
    const errs = validatePreviewValues({ Type: 'quaternary' }, contract);
    assert.strictEqual(errs.length, 1);
    assert.match(errs[0].message, /not one of/);
  });

  it('flags string length rule violations (min and max)', () => {
    assert.strictEqual(validatePreviewValues({ Label: 'hi' }, contract).length, 1); // too short
    assert.strictEqual(validatePreviewValues({ Label: 'x'.repeat(61) }, contract).length, 1); // too long
  });

  it('accumulates multiple errors', () => {
    const errs = validatePreviewValues({ Type: 'bad', Nope: 1, Label: 'hi' }, contract);
    assert.strictEqual(errs.length, 3);
  });

  it('tolerates missing/empty inputs', () => {
    assert.deepStrictEqual(validatePreviewValues(undefined, contract), []);
    assert.deepStrictEqual(validatePreviewValues({ Type: 'primary' }, null), [
      { key: 'Type', message: '"Type" is not a declared property of this component' },
    ]);
  });

  it('checks each element of an array value against the enum', () => {
    const multi = { Tags: { enum: ['a', 'b'] } };
    assert.strictEqual(validatePreviewValues({ Tags: ['a', 'b'] }, multi).length, 0);
    assert.strictEqual(validatePreviewValues({ Tags: ['a', 'z'] }, multi).length, 1);
  });
});

describe('slugifyPreviewKey', () => {
  it('slugifies titles', () => {
    assert.strictEqual(slugifyPreviewKey('Primary — main CTA'), 'primary-main-cta');
    assert.strictEqual(slugifyPreviewKey('  Hello!! '), 'hello');
  });
});
