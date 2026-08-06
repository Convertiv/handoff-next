import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  checkGuardrails,
  componentFieldRules,
  declaredRuleForPath,
  resolveFieldGuardrail,
} from '../src/app/lib/authoring-guardrails';

/**
 * Content limits declared by the **component** rather than by a brief (roadmap E.9).
 *
 * Before this, `maxLength` only existed per-invitation, so an internal author editing an ordinary page got no
 * limits at all. A component can now declare its own structural limit, and a brief layers on top.
 */
describe('componentFieldRules', () => {
  it('flattens a nested properties tree into field paths', () => {
    const rules = componentFieldRules({
      titleSlot: { type: 'text', rules: { maxLength: 60 } },
      bodySlot: { type: 'richtext', rules: { maxLength: 240, required: true } },
      imageSlot: { type: 'image', rules: { dimensions: { width: 100, height: 100 } } },
      meta: { type: 'object', properties: { eyebrow: { type: 'text', rules: { maxLength: 20 } } } },
    });
    // `meta` and `imageSlot` are absent on purpose: a container with no rules of its own, and an image whose
    // only rule is `dimensions`, both contribute nothing rather than an empty entry.
    assert.deepEqual(rules, {
      titleSlot: { maxLength: 60 },
      bodySlot: { maxLength: 240, required: true },
      'meta.eyebrow': { maxLength: 20 },
    });
  });

  /** One rule per field, not per row — so it has to be addressable without an index. */
  it('puts array item fields under `*`', () => {
    const rules = componentFieldRules({
      stats: { type: 'array', items: { properties: { stat: { type: 'text', rules: { maxLength: 12 } } } } },
    });
    assert.deepEqual(rules['stats.*.stat'], { maxLength: 12 });
  });

  it('takes nothing when nothing is declared — no limit is invented', () => {
    assert.deepEqual(componentFieldRules({ titleSlot: { type: 'text' } }), {});
    assert.deepEqual(componentFieldRules(undefined), {});
    assert.deepEqual(componentFieldRules('nonsense'), {});
  });

  it('ignores a zero or negative limit rather than treating it as "no text allowed"', () => {
    assert.deepEqual(componentFieldRules({ a: { rules: { maxLength: 0 } }, b: { rules: { maxLength: -5 } } }), {});
  });
});

describe('declaredRuleForPath', () => {
  const rules = { 'stats.*.stat': { maxLength: 12 }, bodySlot: { maxLength: 240 }, titleSlot: { maxLength: 60 } };

  it('matches an array row through its index', () => {
    assert.deepEqual(declaredRuleForPath(rules, 'stats.0.stat'), { maxLength: 12 });
    assert.deepEqual(declaredRuleForPath(rules, 'stats.7.stat'), { maxLength: 12 });
  });

  /** A serialized React element is declared at its own key; the editable text sits inside `props.children`. */
  it('matches a React-element field through props.children', () => {
    assert.deepEqual(declaredRuleForPath(rules, 'bodySlot.props.children'), { maxLength: 240 });
  });

  it('returns nothing for an undeclared path or no rules at all', () => {
    assert.deepEqual(declaredRuleForPath(rules, 'somethingElse'), {});
    assert.deepEqual(declaredRuleForPath(undefined, 'titleSlot'), {});
  });
});

describe('resolveFieldGuardrail precedence', () => {
  it('prefers an explicit brief rule over the component, even when looser', () => {
    const rule = resolveFieldGuardrail({ fields: { titleSlot: { maxLength: 80 } } }, 'titleSlot', { maxLength: 60 });
    assert.equal(rule.maxLength, 80);
  });

  /**
   * The case a plain fallback chain gets wrong: a blanket brief default must not mask a component's own
   * structural limit, because the component is the more specific statement about that field.
   */
  it("does not let a brief's blanket default mask the component's limit", () => {
    const rule = resolveFieldGuardrail({ defaults: { maxLength: 200 } }, 'titleSlot', { maxLength: 60 });
    assert.equal(rule.maxLength, 60);
  });

  it('falls back to the brief default when the component declares nothing', () => {
    assert.equal(resolveFieldGuardrail({ defaults: { maxLength: 200 } }, 'titleSlot', {}).maxLength, 200);
  });

  it('uses the component limit when the brief says nothing at all', () => {
    assert.equal(resolveFieldGuardrail({}, 'titleSlot', { maxLength: 60 }).maxLength, 60);
  });

  it('has no limit when neither declares one', () => {
    assert.equal(resolveFieldGuardrail({}, 'titleSlot', {}).maxLength, undefined);
  });

  it('carries the component help text through when the brief adds none', () => {
    const rule = resolveFieldGuardrail({}, 'titleSlot', { maxLength: 60, help: 'Keep it short' });
    assert.equal(rule.help, 'Keep it short');
  });
});

describe('checkGuardrails with component-declared limits', () => {
  const blocks = [{ id: 'hero', args: { titleSlot: 'This headline is definitely too long' } }] as never;
  const rulesById = { hero: { titleSlot: { maxLength: 10 } } };

  it('enforces a component limit with no brief config at all', () => {
    const findings = checkGuardrails(blocks, [], {}, rulesById);
    const tooLong = findings.filter((f) => f.code === 'too-long');
    assert.equal(tooLong.length, 1);
    assert.equal(tooLong[0].path, 'titleSlot');
  });

  /** The guarantee that keeps "no declaration → no enforcement" true. */
  it('enforces nothing when no rules are supplied — unchanged behaviour', () => {
    assert.equal(checkGuardrails(blocks, [], {}).filter((f) => f.code === 'too-long').length, 0);
  });

  it('applies a component limit only to the component that declared it', () => {
    const two = [
      { id: 'hero', args: { titleSlot: 'Long enough to trip' } },
      { id: 'card', args: { titleSlot: 'Long enough to trip' } },
    ] as never;
    const findings = checkGuardrails(two, [], {}, rulesById).filter((f) => f.code === 'too-long');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].componentId, 'hero');
  });

  it('flags a required field the component declared and the author left empty', () => {
    const findings = checkGuardrails([{ id: 'hero', args: {} }] as never, [], {}, {
      hero: { titleSlot: { required: true } },
    });
    assert.equal(findings.filter((f) => f.code === 'required-empty').length, 1);
  });
});
