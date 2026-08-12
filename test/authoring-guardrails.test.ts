import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  blockingFindings,
  checkGuardrails,
  guardrailsFromPatternData,
  readGuardrailConfig,
  GuardrailBlockedError,
  componentFieldRules,
  hasAuthoredValue,
  isGuardrailBlockedError,
  measuredLength,
  resolveFieldGuardrail,
  richTextToCopy,
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

/**
 * Richtext limits count the copy, not the markup — roadmap E.9, fixed 2026-08-11.
 *
 * The bug had two halves and both mattered: the server measured `<b>Hi</b>` as 15 characters, and
 * `RichTextField` displayed **no counter at all**, so an author could be blocked by a limit they could not see,
 * counting tags they never typed. 26 of SS&C's ruled fields are richtext.
 */
describe('richTextToCopy', () => {
  it('drops tags and counts only the copy', () => {
    assert.equal(richTextToCopy('<b>Hi</b>'), 'Hi');
    assert.equal(measuredLength('<b>Hi</b>', true), 2);
    assert.equal(measuredLength('<b>Hi</b>'), 9, 'without the richtext flag it is still the raw string');
  });

  /** `<strong>One</strong> unified system.` — the exact shape that made the inline overlay unsafe for richtext. */
  it('keeps inline formatting readable as one sentence', () => {
    assert.equal(richTextToCopy('<strong>One</strong> unified system.'), 'One unified system.');
  });

  /** A *block* boundary is a word boundary: two paragraphs must not fuse into one word. */
  it('treats a block boundary as a space', () => {
    assert.equal(richTextToCopy('<p>Alpha</p><p>Beta</p>'), 'Alpha Beta');
    assert.equal(richTextToCopy('<ul><li>One</li><li>Two</li></ul>'), 'One Two');
  });

  /**
   * ⚠️ An *inline* boundary is not a word boundary, and treating it as one invented a character.
   *
   * Caught by measuring accordion's own shipped copy: `<b>Lorem ipsum dolor sit amet</b>,` read back as
   * `Lorem ipsum dolor sit amet ,` — a space before the comma — reporting 184 characters for 183 of text. It
   * happens once per inline tag adjacent to punctuation, so it compounds.
   */
  it('does not introduce a space where an inline tag closes', () => {
    assert.equal(richTextToCopy('<b>Lorem ipsum</b>, and more'), 'Lorem ipsum, and more');
    assert.equal(richTextToCopy('<em>Yes</em>.'), 'Yes.');
    assert.equal(richTextToCopy('un<b>b</b>roken'), 'unbroken');
    assert.equal(richTextToCopy('<a href="/x">link</a>!'), 'link!');
  });

  /** `<br>` is a visible break, so it does count as a space — unlike the other inline tags. */
  it('counts a line break as a space', () => {
    assert.equal(richTextToCopy('one<br>two'), 'one two');
  });

  it('drops comments without introducing a space', () => {
    assert.equal(richTextToCopy('a<!-- note -->b'), 'ab');
  });

  /** `&nbsp;` is the entity that matters — editors emit it constantly, and 6 characters for a space is absurd. */
  it('decodes the entities an editor actually emits', () => {
    assert.equal(richTextToCopy('a&nbsp;b'), 'a b');
    assert.equal(richTextToCopy('Ben &amp; Jerry&#39;s'), "Ben & Jerry's");
    assert.equal(richTextToCopy('&#x263A;'), '☺');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    assert.equal(richTextToCopy('&fake;'), '&fake;');
  });

  it('ignores script and style bodies', () => {
    assert.equal(richTextToCopy('<style>p{color:red}</style>Copy'), 'Copy');
    assert.equal(richTextToCopy('<script>alert(1)</script>Copy'), 'Copy');
  });

  it('collapses the whitespace tag removal introduces, and trims', () => {
    assert.equal(richTextToCopy('  <p>  spaced   out  </p>  '), 'spaced out');
    assert.equal(richTextToCopy(''), '');
    assert.equal(richTextToCopy('<p></p>'), '');
  });
});

describe('checkGuardrails — richtext is measured as copy', () => {
  /** The declaration is the only thing that knows a field is richtext; args carry an indistinguishable string. */
  const richBlocks = [{ id: 'accordion', args: { paragraph: '<p><b>Ten chars</b></p>' } }];

  it('does not block when the copy fits but the markup would not', () => {
    const findings = checkGuardrails(richBlocks, [], {}, {
      accordion: { paragraph: { maxLength: 12, richtext: true } },
    });
    assert.deepEqual(findings.filter((f) => f.code === 'too-long'), []);
  });

  it('still blocks when the copy itself is too long, and reports the copy count', () => {
    const findings = checkGuardrails(richBlocks, [], {}, {
      accordion: { paragraph: { maxLength: 5, richtext: true } },
    });
    const tooLong = findings.find((f) => f.code === 'too-long');
    assert.ok(tooLong);
    assert.match(tooLong.message, /is 9 characters; the limit is 5/);
  });

  /** Without the marker the old behaviour stands, which is what keeps plain text unaffected. */
  it('measures a non-richtext field raw', () => {
    const findings = checkGuardrails(richBlocks, [], {}, {
      accordion: { paragraph: { maxLength: 12 } },
    });
    assert.equal(findings.find((f) => f.code === 'too-long')?.message.includes('is 23 characters'), true);
  });
});

describe('componentFieldRules — carries the richtext marker', () => {
  it('marks a richtext field so the server measures it as copy', () => {
    const rules = componentFieldRules({
      body: { type: 'richtext', rules: { content: { max: 400 } } },
      title: { type: 'text', rules: { content: { max: 80 } } },
    });
    assert.equal(rules.body.richtext, true);
    assert.equal(rules.title.richtext, undefined);
  });

  it('respects editorType over the raw type, as everywhere else', () => {
    const rules = componentFieldRules({
      slotty: { type: 'React.ReactNode', editorType: 'richtext', rules: { content: { max: 400 } } },
    });
    assert.equal(rules.slotty.richtext, true);
  });

  /** A marker with no limit is not a rule — there would be nothing to enforce or display. */
  it('does not emit a rule for richtext with no limit', () => {
    assert.deepEqual(componentFieldRules({ body: { type: 'richtext', rules: {} } }), {});
  });
});

describe('resolveFieldGuardrail — richtext survives an override', () => {
  it('keeps the marker when a brief overrides the limit', () => {
    const resolved = resolveFieldGuardrail({ fields: { body: { maxLength: 100 } } }, 'body', {
      maxLength: 400,
      richtext: true,
    });
    assert.equal(resolved.maxLength, 100, 'the brief wins on the number');
    assert.equal(resolved.richtext, true, 'but not on how the value is measured');
  });
});

/**
 * `required` asks "has this been given a value?", and it used to ask "is this a non-empty string?" — which made it
 * unsatisfiable on every field holding anything else (2026-08-11).
 *
 * Measured before the fix: **68 false findings across 81 SS&C components**, feeding each component its own shipped
 * preview values. A guest could not clear them by filling anything in, and the submit path refuses on blocking
 * findings, so builds were unsubmittable with no way to fix it.
 */
describe('hasAuthoredValue', () => {
  it('treats absent and blank as missing', () => {
    for (const v of [undefined, null, '', '   ']) assert.equal(hasAuthoredValue(v), false, String(v));
  });

  it('treats real copy as present', () => {
    assert.equal(hasAuthoredValue('Navigate the Landscape'), true);
  });

  /** `Show_stats: false` is a decision, not an omission — 4 SS&C fields hit exactly this. */
  it('counts `false` and `0` as values a person chose', () => {
    assert.equal(hasAuthoredValue(false), true);
    assert.equal(hasAuthoredValue(0), true);
  });

  /** The three labels from the real error: Image, Button, Items. */
  it('counts a populated image, button and repeater', () => {
    assert.equal(hasAuthoredValue({ src: 'https://placehold.co/710x300', alt: 'Portrait' }), true);
    assert.equal(hasAuthoredValue({ url: 'https://ssctech.com', label: 'Talk to Us' }), true);
    assert.equal(hasAuthoredValue([{ title: 'One' }, { title: 'Two' }]), true);
  });

  /** A reference object is judged on its reference — alt text alone must not pass a missing image. */
  it('reads an image with no src as missing, however good its alt text', () => {
    assert.equal(hasAuthoredValue({ src: '', alt: 'Company logo' }), false);
    assert.equal(hasAuthoredValue({ href: '', text: 'Read more' }), false);
  });

  it('treats an empty array, and an array of empty rows, as missing', () => {
    assert.equal(hasAuthoredValue([]), false);
    assert.equal(hasAuthoredValue([{}, { title: '' }]), false);
  });

  it('treats an empty object as missing but a populated one as present', () => {
    assert.equal(hasAuthoredValue({}), false);
    assert.equal(hasAuthoredValue({ title: 'Something' }), true);
  });

  /** A serialized React slot carries its content in `props` — it counts. */
  it('counts a serialized React slot', () => {
    assert.equal(hasAuthoredValue({ key: null, type: 'p', props: { children: 'Body copy' } }), true);
    assert.equal(hasAuthoredValue({ key: null, type: null, props: {} }), false);
  });
});

describe('checkGuardrails — required, end to end', () => {
  /** The exact regression: a component whose required fields are all non-strings, fully populated. */
  const args = {
    logo: { src: 'https://cdn.example/logo.svg', alt: 'Logo' },
    primary: { url: 'https://ssctech.com', label: 'Talk to Us' },
    items: [{ title: 'One' }],
    show_stats: false,
  };
  const rules = {
    hero: {
      logo: { required: true },
      primary: { required: true },
      items: { required: true },
      show_stats: { required: true },
    },
  };

  it('does not block a build whose required non-text fields are all filled', () => {
    const findings = checkGuardrails([{ id: 'hero', args }], [], {}, rules);
    assert.deepEqual(findings.filter((f) => f.code === 'required-empty'), []);
  });

  it('still blocks the ones genuinely left empty', () => {
    const findings = checkGuardrails(
      [{ id: 'hero', args: { ...args, logo: { src: '', alt: 'Logo' }, items: [] } }],
      [],
      {},
      rules
    );
    assert.deepEqual(
      findings.filter((f) => f.code === 'required-empty').map((f) => f.path).sort(),
      ['items', 'logo']
    );
  });
});

describe('GuardrailBlockedError', () => {
  it('carries the findings, so a caller can show them rather than restate them', () => {
    const findings = checkGuardrails([{ id: 'hero', args: {} }], [], {}, { hero: { logo: { required: true } } });
    const err = new GuardrailBlockedError(blockingFindings(findings));
    assert.equal(isGuardrailBlockedError(err), true);
    assert.equal(err.findings.length, 1);
    assert.equal(err.findings[0].path, 'logo');
    assert.match(err.message, /needs fixing|Logo is required/);
  });

  it('recognises the error across a serialization boundary via its code', () => {
    assert.equal(isGuardrailBlockedError({ code: 'GUARDRAILS_BLOCKED' }), true);
    assert.equal(isGuardrailBlockedError(new Error('nope')), false);
  });
});
