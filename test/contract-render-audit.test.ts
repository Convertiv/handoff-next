import assert from 'node:assert';
import { describe, it } from 'node:test';
import { auditContractRender, templatePropertyRefs } from '../src/app/lib/contract-render-audit';

const codes = (input: Parameters<typeof auditContractRender>[0]) => auditContractRender(input).map((f) => f.code);

/** The stored preview value for a React slot: serialized render output, complete with React internals. */
const serializedElement = {
  key: null,
  type: 'img',
  props: { src: '/real.png', alt: 'A described image', width: 600, height: 400 },
  _owner: null,
  _store: {},
};

/**
 * `scaffold → render → assert`, in the parts that can be asserted without a browser (Phase F, `F.-1`).
 *
 * Every case here mirrors a failure recorded in `docs/FIELD-BRIDGE.md` or in the 2026-08-10 MCP gap report,
 * rather than a rule invented for the harness.
 */
describe('auditContractRender — unfeedable previews', () => {
  /** The documented case: declared `{src, alt}` renders, the stored element form is silently ignored. */
  it('flags an element stored against a declared image', () => {
    const findings = auditContractRender({
      componentId: 'hero-background',
      properties: { desktopImageSlot: { type: 'image' } },
      previews: { generic: { values: { desktopImageSlot: serializedElement } } },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'unfeedable-preview');
    assert.match(findings[0].message, /ignores it and renders its own default/);
  });

  /** `buttonSlots` must be a plain array — the component calls `.filter` and the element form crashes it. */
  it('flags an element stored against a declared array', () => {
    const findings = auditContractRender({
      componentId: 'hero-background',
      properties: { buttonSlots: { type: 'array' } },
      previews: { generic: { values: { buttonSlots: serializedElement } } },
    });
    assert.match(findings[0].message, /throws on `\.filter`/);
  });

  /** The exclusion that keeps this usable: a slot legitimately holds an element tree. */
  it('does not flag an element stored against a slot', () => {
    for (const type of ['React.ReactNode', 'slot', 'object', 'any']) {
      assert.deepEqual(
        auditContractRender({
          componentId: 'c',
          properties: { bodySlot: { type } },
          previews: { generic: { values: { bodySlot: serializedElement } } },
        }),
        [],
        `${type} should be allowed to hold an element`
      );
    }
  });

  it('accepts a plain value against a plain declared type', () => {
    assert.deepEqual(
      auditContractRender({
        componentId: 'c',
        properties: { imageSlot: { type: 'image' }, titleSlot: { type: 'text' } },
        previews: { generic: { values: { imageSlot: { src: '/a.png', alt: 'A' }, titleSlot: 'Hello' } } },
      }),
      []
    );
  });

  /** An authored `editorType` states intent and wins, matching how the renderer picks a widget. */
  it('honours editorType over the raw type', () => {
    const findings = codes({
      componentId: 'c',
      properties: { slotty: { type: 'React.ReactNode', editorType: 'image' } },
      previews: { generic: { values: { slotty: serializedElement } } },
    });
    assert.ok(findings.includes('unfeedable-preview'));
  });

  it('reports one finding per field even when several previews are bad', () => {
    const findings = auditContractRender({
      componentId: 'c',
      properties: { imageSlot: { type: 'image' } },
      previews: {
        generic: { values: { imageSlot: serializedElement } },
        live: { values: { imageSlot: serializedElement } },
      },
    });
    assert.equal(findings.length, 1);
  });
});

describe('templatePropertyRefs', () => {
  it('finds properties referenced in mustaches', () => {
    const refs = templatePropertyRefs("<p>{{#field 'paragraph'}}{{properties.paragraph}}{{/field}}</p>");
    assert.ok(refs.has('paragraph'));
  });

  /** A path use is a use of its first segment; treating the whole path as a name would misreport. */
  it('takes only the first segment of a path', () => {
    const refs = templatePropertyRefs('{{#each properties.authors}}{{properties.authors.0.role}}{{/each}}');
    assert.ok(refs.has('authors'));
    assert.ok(!refs.has('role'));
  });

  it('picks up a field helper naming a property the body does not', () => {
    assert.ok(templatePropertyRefs("{{#field 'title'}}{{someAlias}}{{/field}}").has('title'));
  });
});

describe('auditContractRender — template vs contract', () => {
  /** `blog_header`: the template renders an intro paragraph the contract never declares. */
  it('flags a template rendering an undeclared property', () => {
    const findings = auditContractRender({
      componentId: 'blog_header',
      properties: { title: { type: 'text' } },
      template: "<h1>{{properties.title}}</h1><p>{{#field 'paragraph'}}{{properties.paragraph}}{{/field}}</p>",
    });
    const f = findings.find((x) => x.code === 'undeclared-reference');
    assert.ok(f);
    assert.equal(f!.path, 'paragraph');
    assert.match(f!.message, /unsettable through the API/);
  });

  it('flags a declared property the template never renders', () => {
    const findings = auditContractRender({
      componentId: 'c',
      properties: { title: { type: 'text' }, unusedField: { type: 'text' } },
      template: '<h1>{{properties.title}}</h1>',
    });
    const f = findings.find((x) => x.code === 'declared-unrendered');
    assert.equal(f?.path, 'unusedField');
  });

  it('is quiet when the template and contract agree', () => {
    assert.deepEqual(
      auditContractRender({
        componentId: 'c',
        properties: { title: { type: 'text' } },
        template: '<h1>{{properties.title}}</h1>',
      }),
      []
    );
  });

  /** Without the source there is nothing to compare, and silence is the honest answer. */
  it('skips the template checks when no template is supplied', () => {
    assert.deepEqual(
      auditContractRender({ componentId: 'c', properties: { onlyDeclared: { type: 'text' } } }),
      []
    );
    assert.deepEqual(
      auditContractRender({ componentId: 'c', properties: { onlyDeclared: { type: 'text' } }, template: '   ' }),
      []
    );
  });

  it('tolerates nonsense input', () => {
    assert.deepEqual(auditContractRender({ componentId: 'c', properties: undefined }), []);
    assert.deepEqual(auditContractRender({ componentId: 'c', properties: 'nope', previews: 'nope' }), []);
  });
});

/**
 * Nested paths, which the first run of this harness got wrong.
 *
 * Templates address repeater content as `{{#field "items.title"}}` inside an `{{#each}}`. Comparing refs against
 * top-level keys alone reported four false positives on `accordion` — noise of exactly the kind that makes a
 * report ignorable, so the fix was to resolve nesting rather than approximate it.
 */
describe('auditContractRender — nested declarations', () => {
  const accordion = {
    properties: {
      title: { type: 'text' },
      items: {
        type: 'array',
        items: { properties: { title: { type: 'text' }, paragraph: { type: 'richtext' }, link: { type: 'link' } } },
      },
    },
  };

  it('accepts a template addressing an array item field', () => {
    const findings = auditContractRender({
      componentId: 'accordion',
      ...accordion,
      template: `{{properties.title}}{{#each properties.items}}{{#field "items.title"}}{{/field}}{{#field "items.paragraph"}}{{/field}}{{#field "items.link"}}{{/field}}{{/each}}`,
    });
    assert.deepEqual(findings, []);
  });

  it('accepts a nested object field', () => {
    assert.deepEqual(
      auditContractRender({
        componentId: 'c',
        properties: { author: { type: 'object', properties: { linked_in: { type: 'link' } } } },
        template: `{{#field "author.linked_in"}}{{/field}}`,
      }),
      []
    );
  });

  /** The real `blog_header` bug: the template says `author`, the contract declares `authors`. */
  it('still catches a singular/plural mismatch', () => {
    const findings = auditContractRender({
      componentId: 'blog_header',
      properties: { authors: { type: 'array', items: { properties: { linked_in: { type: 'link' } } } } },
      template: `{{#field "author.linked_in"}}{{/field}}{{#each properties.authors}}{{/each}}`,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'undeclared-reference');
    assert.equal(findings[0].path, 'author.linked_in');
  });

  /** A rendered parent exercises its children; descending would report every leaf as unrendered. */
  it('does not report nested fields as unrendered when the parent is used', () => {
    const findings = auditContractRender({
      componentId: 'accordion',
      ...accordion,
      template: '{{properties.title}}{{#each properties.items}}{{/each}}',
    });
    assert.equal(findings.filter((f) => f.code === 'declared-unrendered').length, 0);
  });
});
