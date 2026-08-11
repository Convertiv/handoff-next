import assert from 'node:assert';
import { describe, it } from 'node:test';
import { auditContractLimits } from '../src/app/lib/contract-limit-audit';

const codes = (input: Parameters<typeof auditContractLimits>[0]) =>
  auditContractLimits(input).map((f) => f.code);

/**
 * Limits a component contradicts itself about (Phase F, `F.-1`).
 *
 * The oracle is the component's own preview: a cap that rejects the value the component ships is wrong without
 * anyone needing the real content corpus. Reproduces the `blog_header` shape that blocked the ALPS migration.
 */
describe('auditContractLimits — self-contradiction', () => {
  it("flags a cap the component's own preview exceeds", () => {
    const findings = auditContractLimits({
      componentId: 'blog_header',
      properties: { title: { type: 'text', rules: { content: { max: 25, min: 5 } } } },
      previews: { generic: { values: { title: 'A Hidden Feature of Private Market Returns' } } },
    });
    const f = findings.find((x) => x.code === 'preview-exceeds-max');
    assert.ok(f);
    assert.equal(f!.path, 'title');
    assert.match(f!.message, /allows 25 characters, but the component's own value is 42/);
  });

  it('accepts a cap the preview fits inside', () => {
    assert.ok(
      !codes({
        componentId: 'c',
        properties: { title: { rules: { content: { max: 60 } } } },
        previews: { generic: { values: { title: 'Industry trends roundup' } } },
      }).includes('preview-exceeds-max')
    );
  });

  /** One preview ducking the cap must not hide another that exceeds it. */
  it('measures the longest value across all previews, not the first', () => {
    const findings = codes({
      componentId: 'c',
      properties: { title: { rules: { content: { max: 25 } } } },
      previews: {
        live: { values: { title: 'Short one' } },
        generic: { values: { title: 'A considerably longer headline than the cap allows' } },
      },
    });
    assert.ok(findings.includes('preview-exceeds-max'));
  });

  it('flags a minimum the preview falls under', () => {
    const findings = codes({
      componentId: 'c',
      properties: { read_time: { rules: { content: { min: 25 } } } },
      previews: { generic: { values: { read_time: '12 min read' } } },
    });
    assert.ok(findings.includes('preview-under-min'));
  });

  /** Falls back to the declared default when no preview covers the field. */
  it('uses the declared default as the oracle when previews say nothing', () => {
    const findings = codes({
      componentId: 'c',
      properties: { label: { default: 'Talk to our distribution team', rules: { content: { max: 10 } } } },
      previews: {},
    });
    assert.ok(findings.includes('preview-exceeds-max'));
  });

  it('reports nothing when no limits are declared', () => {
    assert.deepEqual(
      auditContractLimits({
        componentId: 'c',
        properties: { title: { type: 'text', rules: { required: true } } },
        previews: { generic: { values: { title: 'Anything at all goes here' } } },
      }),
      []
    );
  });
});

describe('auditContractLimits — the copy-paste signature', () => {
  /** The exact shape found on `blog_header`: one block pasted down the property list. */
  it('flags an identical limit block shared by three or more fields', () => {
    const findings = auditContractLimits({
      componentId: 'blog_header',
      properties: {
        title: { rules: { content: { max: 25, min: 5 } } },
        read_time: { rules: { content: { max: 25, min: 5 } } },
        publication_date: { rules: { content: { max: 25, min: 5 } } },
      },
      previews: {},
    });
    const dup = findings.find((f) => f.code === 'duplicated-rules');
    assert.ok(dup);
    assert.equal(dup!.fields?.length, 3);
    assert.equal(dup!.path, null);
    assert.match(dup!.message, /min: 5, max: 25/);
  });

  it('does not flag two fields sharing a limit — that is a coincidence, not a pattern', () => {
    assert.ok(
      !codes({
        componentId: 'c',
        properties: { a: { rules: { content: { max: 25 } } }, b: { rules: { content: { max: 25 } } } },
        previews: {},
      }).includes('duplicated-rules')
    );
  });

  it('finds the block inside array items too', () => {
    const findings = auditContractLimits({
      componentId: 'blog_header',
      properties: {
        title: { rules: { content: { max: 25, min: 5 } } },
        authors: {
          type: 'array',
          items: {
            properties: {
              author: { rules: { content: { max: 25, min: 5 } } },
              role: { rules: { content: { max: 25, min: 5 } } },
            },
          },
        },
      },
      previews: {},
    });
    const dup = findings.find((f) => f.code === 'duplicated-rules');
    assert.deepEqual(dup?.fields, ['title', 'authors.*.author', 'authors.*.role']);
  });
});

describe('auditContractLimits — caps on URLs', () => {
  /** The template shipped `max: 25` on `url`, which rejects almost every real URL. */
  it('flags a character cap on a URL field', () => {
    assert.ok(codes({ componentId: 'c', properties: { url: { rules: { content: { max: 25 } } } } }).includes('max-on-url'));
    assert.ok(codes({ componentId: 'c', properties: { cta_href: { rules: { content: { max: 30 } } } } }).includes('max-on-url'));
  });

  it('leaves a copy field alone', () => {
    assert.ok(!codes({ componentId: 'c', properties: { title: { rules: { content: { max: 25 } } } } }).includes('max-on-url'));
  });

  /** `required` on a URL is a real constraint; only the length cap is the mistake. */
  it('does not flag a URL with no length cap', () => {
    assert.deepEqual(auditContractLimits({ componentId: 'c', properties: { url: { rules: { required: true } } } }), []);
  });
});

describe('auditContractLimits — legacy shape', () => {
  it('still reads the flat maxLength alias', () => {
    const findings = codes({
      componentId: 'c',
      properties: { title: { rules: { maxLength: 10 } } },
      previews: { generic: { values: { title: 'Longer than ten' } } },
    });
    assert.ok(findings.includes('preview-exceeds-max'));
  });

  it('tolerates nonsense input', () => {
    assert.deepEqual(auditContractLimits({ componentId: 'c', properties: undefined }), []);
    assert.deepEqual(auditContractLimits({ componentId: 'c', properties: 'nope', previews: 'nope' }), []);
  });
});
