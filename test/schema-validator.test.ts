import assert from 'node:assert';
import { describe, it } from 'node:test';
import { schema } from '@handoff/validators/schema';
import type { ValidatorInput } from '@handoff/types/validation';

function inputFor(component: unknown): ValidatorInput {
  return {
    component: component as ValidatorInput['component'],
    previewPath: null,
    workingPath: '/tmp',
  };
}

const baseButton = {
  id: 'button',
  title: 'Button',
  description: 'Site buttons.',
  entries: { template: './template.hbs' },
  properties: {
    Type: { description: 'Button type', type: 'text', enum: ['primary', 'secondary', 'tertiary'] },
    Label: { description: 'Button label', type: 'text' },
  },
};

describe('schema validator — preview enum membership', () => {
  it('passes when preview enum values are valid', async () => {
    const result = await schema().run(
      inputFor({
        ...baseButton,
        previews: { primary: { title: 'Primary', values: { Type: 'primary', Label: 'Go' } } },
      })
    );
    const enumFindings = result.findings.filter((f) => f.ruleId === 'schema.preview-invalid-enum');
    assert.strictEqual(enumFindings.length, 0);
  });

  it('flags a preview value not in the property enum', async () => {
    const result = await schema().run(
      inputFor({
        ...baseButton,
        previews: { bad: { title: 'Bad', values: { Type: 'quaternary' } } },
      })
    );
    const enumFindings = result.findings.filter((f) => f.ruleId === 'schema.preview-invalid-enum');
    assert.strictEqual(enumFindings.length, 1);
    assert.strictEqual(enumFindings[0].severity, 'warning');
    assert.strictEqual(enumFindings[0].target, 'previews.bad.values.Type');
  });

  it('does not flag values for properties without an enum', async () => {
    const result = await schema().run(
      inputFor({
        ...baseButton,
        previews: { p: { title: 'P', values: { Label: 'anything goes' } } },
      })
    );
    assert.strictEqual(
      result.findings.filter((f) => f.ruleId === 'schema.preview-invalid-enum').length,
      0
    );
  });

  it('can be disabled via options', async () => {
    const result = await schema({ validatePreviewEnums: false }).run(
      inputFor({
        ...baseButton,
        previews: { bad: { title: 'Bad', values: { Type: 'quaternary' } } },
      })
    );
    assert.strictEqual(
      result.findings.filter((f) => f.ruleId === 'schema.preview-invalid-enum').length,
      0
    );
  });
});
