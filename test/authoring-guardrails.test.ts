import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  blockingFindings,
  checkGuardrails,
  guardrailsFromPatternData,
  readGuardrailConfig,
  resolveFieldGuardrail,
  summarizeBlocking,
  type GuardrailConfig,
} from '../src/app/lib/authoring-guardrails';

/**
 * Guardrails run in three places — editor, submit, review — so the rules live in one tested module. The
 * cases that matter most are the ones where a check could *invent* a limit nobody configured, or let a
 * required field pass by not existing.
 */

const blocks = [
  {
    id: 'hero-background',
    args: {
      headline: 'Retirement, handled',
      bodySlot: { key: 'b', type: 'p', props: { children: 'Body copy from the template.', className: 'lead' } },
      ctaSlot: { key: 'c', type: 'a', props: { children: 'Learn more', href: '/plans' } },
      desktopImageSlot: { key: 'i', type: 'img', props: { src: '/hero.jpg', alt: 'A team at a desk', width: 1280 } },
    },
  },
];

describe('checkGuardrails — nothing is invented', () => {
  it('finds nothing when no limits are configured', () => {
    // The engine must not infer that a 19-character template headline implies a 19-character rule.
    assert.deepEqual(checkGuardrails(blocks, [{}], {}), []);
  });

  it('applies a template-wide default only where no override exists', () => {
    const config: GuardrailConfig = { defaults: { maxLength: 10 }, fields: { headline: { maxLength: 40 } } };
    const findings = checkGuardrails(blocks, [{}], config);
    const paths = findings.map((f) => f.path);
    assert.ok(!paths.includes('headline'), 'headline is within its own 40 limit');
    assert.ok(paths.includes('bodySlot.props.children'), 'body falls back to the default 10');
  });

  it('reports a too-long field as blocking, with the numbers in the message', () => {
    const findings = checkGuardrails(blocks, [{}], { fields: { headline: { maxLength: 10 } } });
    const finding = findings.find((f) => f.path === 'headline');
    assert.equal(finding?.severity, 'blocking');
    assert.equal(finding?.code, 'too-long');
    assert.match(finding!.message, /19 characters/);
    assert.match(finding!.message, /limit is 10/);
  });

  it('measures the raw value for max but the trimmed value for min', () => {
    // Trailing spaces should not buy you length, and should not be counted against a minimum either.
    const padded = [{ headline: 'abc   ' }];
    assert.equal(checkGuardrails(blocks, padded, { fields: { headline: { minLength: 4 } } }).length, 1);
    assert.equal(checkGuardrails(blocks, padded, { fields: { headline: { maxLength: 6 } } }).length, 0);
  });

  it('ignores a minimum on an empty field, which is the required check’s job', () => {
    const findings = checkGuardrails(blocks, [{ headline: '' }], { fields: { headline: { minLength: 5 } } });
    assert.deepEqual(findings.filter((f) => f.code === 'too-short'), []);
  });
});

describe('checkGuardrails — required', () => {
  it('catches an empty required field', () => {
    const findings = checkGuardrails(blocks, [{ headline: '   ' }], { fields: { headline: { required: true } } });
    const finding = findings.find((f) => f.code === 'required-empty');
    assert.equal(finding?.severity, 'blocking');
    assert.equal(finding?.label, 'Headline');
  });

  it('catches a required field that is absent entirely', () => {
    // The failure a required check exists for: `collectEditableText` cannot see a field that isn't there,
    // so absence must not pass.
    const findings = checkGuardrails(blocks, [{}], { fields: { eyebrow: { required: true } } });
    assert.equal(findings.filter((f) => f.code === 'required-empty').length, 1);
  });

  it('reports a required field exactly once', () => {
    const findings = checkGuardrails(blocks, [{ headline: '' }], {
      fields: { headline: { required: true, minLength: 5, maxLength: 10 } },
    });
    assert.equal(findings.filter((f) => f.code === 'required-empty').length, 1);
  });

  it('passes a filled required field', () => {
    assert.deepEqual(
      checkGuardrails(blocks, [{}], { fields: { headline: { required: true } } }).filter((f) => f.code === 'required-empty'),
      []
    );
  });
});

describe('checkGuardrails — images and links', () => {
  it('flags a missing alt as advisory by default', () => {
    const noAlt = [{ desktopImageSlot: { key: 'i', type: 'img', props: { src: '/hero.jpg', width: 1280 } } }];
    const finding = checkGuardrails(blocks, noAlt, {}).find((f) => f.code === 'missing-alt');
    assert.equal(finding?.severity, 'advisory', 'advisory by default — it should annotate review, not block');
  });

  it('can be configured to block on a missing alt, or to skip the check', () => {
    const noAlt = [{ desktopImageSlot: { key: 'i', type: 'img', props: { src: '/hero.jpg' } } }];
    assert.equal(checkGuardrails(blocks, noAlt, { requireImageAlt: 'blocking' })[0].severity, 'blocking');
    assert.deepEqual(checkGuardrails(blocks, noAlt, { requireImageAlt: false }), []);
  });

  it('accepts an image that has alt text', () => {
    assert.deepEqual(checkGuardrails(blocks, [{}], {}).filter((f) => f.code === 'missing-alt'), []);
  });

  it('flags uninformative link text only when asked, and only advisorily', () => {
    assert.deepEqual(checkGuardrails(blocks, [{}], {}).filter((f) => f.code === 'weak-link-text'), []);
    const finding = checkGuardrails(blocks, [{}], { checkLinkText: true }).find((f) => f.code === 'weak-link-text');
    assert.equal(finding?.severity, 'advisory');
    assert.match(finding!.message, /Learn more/);
  });

  it('does not flag descriptive link text', () => {
    const good = [{ ctaSlot: { key: 'c', type: 'a', props: { children: 'See the 2026 plan options', href: '/plans' } } }];
    assert.deepEqual(
      checkGuardrails(blocks, good, { checkLinkText: true }).filter((f) => f.code === 'weak-link-text'),
      []
    );
  });
});

describe('config parsing', () => {
  it('drops nonsense rather than trusting stored data', () => {
    const config = readGuardrailConfig({
      defaults: { maxLength: -5 },
      fields: { headline: { maxLength: 'lots', minLength: 0, required: 'yes' }, other: 'nope' },
      requireImageAlt: 'sometimes',
      checkLinkText: 'yes',
    });
    assert.deepEqual(config, {});
  });

  it('reads a well-formed config', () => {
    const config = readGuardrailConfig({
      defaults: { maxLength: 120 },
      fields: { headline: { maxLength: 60, required: true, help: 'Keep it to one line.' } },
      requireImageAlt: 'blocking',
      checkLinkText: true,
    });
    assert.deepEqual(config.defaults, { maxLength: 120 });
    assert.deepEqual(config.fields?.headline, { maxLength: 60, required: true, help: 'Keep it to one line.' });
    assert.equal(config.requireImageAlt, 'blocking');
    assert.equal(config.checkLinkText, true);
  });

  it('reads guardrails off a pattern’s data, tolerating absence', () => {
    assert.deepEqual(guardrailsFromPatternData(null), {});
    assert.deepEqual(guardrailsFromPatternData({}), {});
    assert.equal(guardrailsFromPatternData({ guardrails: { defaults: { maxLength: 80 } } }).defaults?.maxLength, 80);
  });

  it('resolves per-field over default', () => {
    const config: GuardrailConfig = { defaults: { maxLength: 100 }, fields: { headline: { maxLength: 60 } } };
    assert.equal(resolveFieldGuardrail(config, 'headline').maxLength, 60);
    assert.equal(resolveFieldGuardrail(config, 'bodySlot.props.children').maxLength, 100);
    assert.equal(resolveFieldGuardrail({}, 'headline').maxLength, undefined);
  });
});

describe('summarizing', () => {
  it('separates blocking from advisory', () => {
    const findings = checkGuardrails(
      [{ id: 'hero', args: { headline: 'way too long for this', img: { src: '/x.jpg' } } }],
      [{}],
      { fields: { headline: { maxLength: 5 } } }
    );
    assert.equal(blockingFindings(findings).length, 1);
    assert.equal(findings.length, 2, 'the missing alt is still reported, just not blocking');
  });

  it('says nothing when nothing blocks', () => {
    assert.equal(summarizeBlocking(checkGuardrails(blocks, [{}], {})), '');
  });

  it('names the single problem, or counts several', () => {
    const one = checkGuardrails(blocks, [{}], { fields: { headline: { maxLength: 5 } } });
    assert.match(summarizeBlocking(one), /^Headline is 19 characters/);

    const many = checkGuardrails(blocks, [{}], {
      fields: { headline: { maxLength: 5 }, 'bodySlot.props.children': { maxLength: 5 }, eyebrow: { required: true } },
    });
    assert.match(summarizeBlocking(many), /^3 things need fixing/);
  });
});
