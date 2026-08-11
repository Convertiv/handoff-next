import assert from 'node:assert';
import { describe, it } from 'node:test';
import { contentLengthPlan, roleFor, summarizePlan, type PlanEntry } from '../src/app/lib/content-length-plan';

/**
 * The proposed content limits — the "rationalize these" half of the length work.
 *
 * Every case here comes from the SS&C survey (83 components, 614 fields, 420 with a length rule) rather than from
 * imagination, because the point of a recommender is that its guesses are defensible. The two that were caught by
 * running it over the real catalog get their own tests, marked below.
 */
const plan = (properties: unknown, previews?: unknown): PlanEntry[] =>
  contentLengthPlan({ componentId: 'c', properties, previews });
const at = (entries: PlanEntry[], path: string) => entries.find((e) => e.path === path);

describe('contentLengthPlan — what gets removed', () => {
  it('drops the rule on a reference or composite type', () => {
    const out = plan({
      cta: { type: 'button', rules: { content: { min: 5, max: 25 } } },
      icon: { type: 'icon', rules: { content: { min: 5, max: 500 } } },
    });
    assert.deepEqual(
      out.map((e) => e.action),
      ['remove-rule', 'remove-rule']
    );
    assert.deepEqual(out[0].proposed, {}, 'no cap survives');
  });

  /**
   * ⚠️ Caught while applying the plan to the real repo. On an `array` `content` is a **row count** and on a
   * `number` a **value range** — `hero_split.breadcrumb` max 4, `blog_header.authors` max 2,
   * `stats.items.*.duration` spanning ±10,000,000. The first pass classified both as "not free text" and proposed
   * deleting all 78 of them, which would have thrown away deliberately-authored constraints.
   */
  it('leaves a row count and a value range completely alone', () => {
    const out = plan({
      items: { type: 'array', rules: { content: { min: 1, max: 6 } } },
      count: { type: 'number', rules: { content: { min: 0, max: 999 } } },
    });
    assert.deepEqual(
      out.map((e) => e.action),
      ['not-a-length', 'not-a-length']
    );
    // The cap is echoed back unchanged, and the minimum is not proposed away.
    assert.equal(at(out, 'items')?.proposed.max, 6);
    assert.equal(at(out, 'count')?.proposed.max, 999);
  });

  /** `cta_url` and `map_url` are declared `text` in SS&C — the name is the only signal. */
  it('drops the rule on a URL declared as text', () => {
    const out = plan({ cta_url: { type: 'text', rules: { content: { max: 1000 } } } });
    assert.equal(at(out, 'cta_url')?.action, 'remove-rule');
  });

  /**
   * ⚠️ Caught by running the recommender over the real catalog. `menu.primary.*.mega.link` is typed `text`, named
   * "Bottom Link Text" and rendered as the anchor's *label* — its 25-character cap is real, because the label sits
   * in a fixed-width mega-menu footer. Matching `link` as a URL name stripped it.
   */
  it('does not mistake a text field named `link` for a URL', () => {
    const out = plan(
      { link: { type: 'text', rules: { content: { min: 1, max: 25 } } } },
      { generic: { values: { link: 'View all solutions' } } }
    );
    assert.notEqual(at(out, 'link')?.action, 'remove-rule');
    // Treated as the CTA label it is: the `link` role's floor, not a deletion.
    assert.equal(at(out, 'link')?.role, 'link');
    assert.equal(at(out, 'link')?.proposed.max, 32);
  });

  it('still drops the rule on a `link`-typed field', () => {
    assert.equal(at(plan({ link: { type: 'link', rules: { content: { max: 100 } } } }), 'link')?.action, 'remove-rule');
  });

  it('drops the rule on configuration', () => {
    const out = plan({ class: { type: 'text', rules: { content: { max: 10 } } } });
    assert.equal(at(out, 'class')?.action, 'remove-rule');
  });
});

describe('contentLengthPlan — the minimum always goes', () => {
  /** 389 of SS&C's 420 ruled fields carry a minimum, and not one of them prevents a layout break. */
  it('proposes no minimum, ever', () => {
    const out = plan(
      { title: { type: 'text', rules: { required: true, content: { min: 5, max: 200 } } } },
      { generic: { values: { title: 'Short' } } }
    );
    assert.equal('min' in (at(out, 'title')?.proposed ?? {}), false);
  });

  it('reports drop-min when the cap is already right', () => {
    const out = plan(
      { title: { type: 'text', rules: { content: { min: 5, max: 80 } } } },
      { generic: { values: { title: 'A headline' } } }
    );
    assert.equal(at(out, 'title')?.action, 'drop-min');
    assert.equal(at(out, 'title')?.proposed.max, 80);
  });

  it('reports keep when there was no minimum and the cap fits', () => {
    const out = plan(
      { title: { type: 'text', rules: { content: { max: 80 } } } },
      { generic: { values: { title: 'A headline' } } }
    );
    assert.equal(at(out, 'title')?.action, 'keep');
  });
});

describe('contentLengthPlan — raising a cap', () => {
  /** The pasted `{min: 5, max: 25}`: 80 SS&C fields carry it, and a section heading needs more than 25. */
  it('raises a heading to its role floor', () => {
    const out = plan(
      { title: { type: 'text', rules: { content: { min: 5, max: 25 } } } },
      { generic: { values: { title: 'Reliable' } } }
    );
    assert.equal(at(out, 'title')?.action, 'raise-max');
    assert.equal(at(out, 'title')?.proposed.max, 80);
    assert.equal(at(out, 'title')?.role, 'title');
  });

  /** A card title is narrower than a section title — context, not a second name. */
  it('uses the narrower floor for a heading inside a repeater row', () => {
    const out = plan({
      items: { type: 'array', items: { properties: { title: { type: 'text', rules: { content: { max: 25 } } } } } },
    });
    assert.equal(at(out, 'items.*.title')?.proposed.max, 60);
  });

  /** The evidence floor: never propose a cap the component's own content would fail. */
  it('clears the component´s own longest value when that exceeds the role floor', () => {
    const out = plan(
      { paragraph: { type: 'text', rules: { content: { max: 300 } } } },
      { generic: { values: { paragraph: 'x'.repeat(361) } } }
    );
    // 361 × 1.2, rounded up to the next 10.
    assert.equal(at(out, 'paragraph')?.proposed.max, 440);
    assert.equal(at(out, 'paragraph')?.observed, 361);
  });

  it('reads every row of a repeater, not just the first', () => {
    const out = plan(
      { items: { type: 'array', items: { properties: { quote: { type: 'text', rules: { content: { max: 100 } } } } } } },
      { generic: { values: { items: [{ quote: 'short' }, { quote: 'x'.repeat(136) }] } } }
    );
    assert.equal(at(out, 'items.*.quote')?.observed, 136);
  });

  /**
   * ⚠️ Caught by running the recommender over the real catalog. Adding headroom to content that already fits
   * restated 30-odd caps for no reason and buried the findings that mattered.
   */
  it('leaves a cap alone when the content already fits it', () => {
    // A name with no role, so only the evidence could move it — and the evidence says it fits.
    const out = plan(
      { transcript: { type: 'text', rules: { content: { max: 900 } } } },
      { generic: { values: { transcript: 'x'.repeat(859) } } }
    );
    assert.equal(at(out, 'transcript')?.action, 'keep');
    assert.equal(at(out, 'transcript')?.proposed.max, 900);
  });

  it('falls back to the declared default when no preview covers the field', () => {
    const out = plan({ title: { type: 'text', default: 'x'.repeat(90), rules: { content: { max: 25 } } } });
    assert.equal(at(out, 'title')?.observed, 90);
    assert.equal(at(out, 'title')?.proposed.max, 110);
  });
});

describe('contentLengthPlan — lowering a nominal cap', () => {
  it('pulls in a cap that is many times its role floor', () => {
    const out = plan(
      { paragraph: { type: 'text', rules: { content: { max: 5000 } } } },
      { generic: { values: { paragraph: 'x'.repeat(78) } } }
    );
    assert.equal(at(out, 'paragraph')?.action, 'lower-max');
    assert.equal(at(out, 'paragraph')?.proposed.max, 320);
  });

  /**
   * ⚠️ Caught by running the recommender over the real catalog. Richtext caps count *markup*, so they are not
   * comparable to a floor derived from plain text — and the generous ones are deliberate. Pulling
   * `accordion.items.*.paragraph` from 5000 to 320 would have broken a multi-paragraph accordion body.
   */
  it('never pulls in a richtext cap', () => {
    const out = plan(
      { paragraph: { type: 'richtext', rules: { content: { min: 5, max: 5000 } } } },
      { generic: { values: { paragraph: '<p>short</p>' } } }
    );
    assert.equal(at(out, 'paragraph')?.action, 'drop-min');
    assert.equal(at(out, 'paragraph')?.proposed.max, 5000);
    assert.equal(at(out, 'paragraph')?.countsMarkup, true);
  });

  /** A richtext cap its own content already fails is still a contradiction worth fixing. */
  it('still raises a richtext cap the content exceeds', () => {
    const out = plan(
      { paragraph: { type: 'richtext', rules: { content: { max: 100 } } } },
      { generic: { values: { paragraph: '<p>' + 'x'.repeat(200) + '</p>' } } }
    );
    assert.equal(at(out, 'paragraph')?.action, 'raise-max');
  });
});

describe('roleFor', () => {
  it('matches a known role', () => {
    assert.deepEqual(roleFor('title_prefix', false), { role: 'title_prefix', limit: 40 });
  });

  /** The composed names a flat table always misses: `col1_label`, `map_title`, `feature_title`. */
  it('falls back to an affix', () => {
    assert.equal(roleFor('col1_label', false)?.role, 'label');
    assert.equal(roleFor('map_title', false)?.role, 'title');
    assert.equal(roleFor('title_muted', false)?.role, 'title');
  });

  it('returns null for a name it has no opinion about', () => {
    assert.equal(roleFor('transcript', false), null);
    assert.equal(roleFor('colorKey', false), null);
  });
});

describe('contentLengthPlan — refusing to guess', () => {
  it('reports no-basis with no role and no sample', () => {
    const out = plan({ colorKey: { type: 'text', rules: { content: { max: 255 } } } });
    assert.equal(at(out, 'colorKey')?.action, 'no-basis');
    assert.equal(at(out, 'colorKey')?.proposed.max, 255, 'left exactly as declared');
  });

  it('ignores fields that declare no length rule at all', () => {
    assert.deepEqual(plan({ title: { type: 'text', rules: { required: true } }, other: { type: 'text' } }), []);
  });

  it('tolerates nonsense', () => {
    assert.deepEqual(plan(undefined), []);
    assert.deepEqual(plan('nope', 'nope'), []);
  });
});

describe('summarizePlan', () => {
  it('counts the numbers a health check reports', () => {
    const entries = plan(
      {
        title: { type: 'text', rules: { content: { min: 5, max: 25 } } },
        body: { type: 'richtext', rules: { content: { min: 5, max: 5000 } } },
        cta_url: { type: 'text', rules: { content: { max: 1000 } } },
      },
      { generic: { values: { title: 'x'.repeat(40), body: '<p>hi</p>', cta_url: '/a' } } }
    );
    const s = summarizePlan(entries);
    assert.equal(s.fields, 3);
    assert.equal(s.withMin, 2);
    assert.equal(s.selfContradicting, 1, 'the title exceeds its own cap');
    assert.equal(s.markupCounted, 1);
    assert.equal(s.byAction['remove-rule'], 1);
  });
});
