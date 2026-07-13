import assert from 'node:assert';
import { describe, it } from 'node:test';
import { applyFieldAnnotations } from '@handoff/transformers/preview/component/field-annotations';
import { SlotType, type SlotMetadata } from '@handoff/transformers/preview/slots';

const baseProps = (): Record<string, SlotMetadata> => ({
  theme: { name: 'theme', description: '', generic: 'string', type: SlotType.TEXT },
  imageSlot: { name: 'imageSlot', description: '', generic: 'React.ReactNode', type: SlotType.ANY },
  anchor: { name: 'anchor', description: '', generic: 'string', type: SlotType.TEXT },
});

describe('applyFieldAnnotations', () => {
  it('is a no-op when there are no fields', () => {
    const props = baseProps();
    assert.deepStrictEqual(applyFieldAnnotations(props, undefined), props);
  });

  it('does not mutate the input map', () => {
    const props = baseProps();
    applyFieldAnnotations(props, { anchor: { hidden: true } });
    assert.ok(props.anchor, 'original map still has anchor');
  });

  it('hides a code-only prop', () => {
    const out = applyFieldAnnotations(baseProps(), { anchor: { hidden: true } });
    assert.strictEqual(out.anchor, undefined);
    assert.ok(out.theme, 'other props untouched');
  });

  it('sets editorType and derives the closed type from it', () => {
    const out = applyFieldAnnotations(baseProps(), { imageSlot: { editorType: 'image', label: 'Image' } });
    assert.strictEqual(out.imageSlot.editorType, 'image');
    assert.strictEqual(out.imageSlot.type, SlotType.IMAGE);
    assert.strictEqual(out.imageSlot.name, 'Image');
  });

  it('normalizes options and maps select → ENUM', () => {
    const out = applyFieldAnnotations(baseProps(), {
      theme: { editorType: 'select', options: ['light', { value: 'dark', label: 'Dark' }] },
    });
    assert.strictEqual(out.theme.type, SlotType.ENUM);
    assert.deepStrictEqual(out.theme.options, [{ value: 'light' }, { value: 'dark', label: 'Dark' }]);
  });

  it('shapes an array field via `of`', () => {
    const out = applyFieldAnnotations(baseProps(), {
      imageSlot: { editorType: 'array', of: 'button', label: 'CTAs' },
    });
    assert.strictEqual(out.imageSlot.type, SlotType.ARRAY);
    assert.strictEqual(out.imageSlot.items?.type, SlotType.BUTTON);
    assert.strictEqual(out.imageSlot.items?.editorType, 'button');
  });

  it('creates a property for an annotation with no inferred prop', () => {
    const out = applyFieldAnnotations(baseProps(), { extra: { editorType: 'richtext', label: 'Extra' } });
    assert.ok(out.extra);
    assert.strictEqual(out.extra.type, SlotType.TEXT);
    assert.strictEqual(out.extra.name, 'Extra');
  });

  it('never copies the `render` function into the property', () => {
    const out = applyFieldAnnotations(baseProps(), {
      imageSlot: { editorType: 'image', render: (v: unknown) => v },
    });
    assert.ok(!('render' in out.imageSlot));
  });

  it('merges rules and default', () => {
    const out = applyFieldAnnotations(baseProps(), {
      theme: { rules: { required: true }, default: 'light' },
    });
    assert.strictEqual(out.theme.rules?.required, true);
    assert.strictEqual(out.theme.default, 'light');
  });
});
