import assert from 'node:assert';
import { describe, it } from 'node:test';
import { auditBuild, groupAuditFindings } from '../src/app/lib/build-audits';

const codes = (blocks: unknown, overrides: unknown[] = []) =>
  auditBuild(blocks as never, overrides).map((f) => f.code);

/**
 * Standing quality checks on a built page (roadmap E.10).
 *
 * These read content values, not rendered HTML — there is no server-rendered DOM for React components, so an
 * HTML pass would have inspected a props script. See `build-audits.ts` for the full reasoning.
 */
describe('auditBuild — content', () => {
  it('finds placeholder copy left in', () => {
    const found = auditBuild(
      [{ id: 'hero', args: { bodySlot: 'Lorem ipsum dolor sit amet, consectetur.' } }] as never,
      []
    );
    const placeholder = found.filter((f) => f.code === 'placeholder-text');
    assert.equal(placeholder.length, 1);
    assert.equal(placeholder[0].path, 'bodySlot');
    assert.equal(placeholder[0].category, 'content');
  });

  it('finds placeholder imagery by host', () => {
    const found = codes([
      { id: 'g', args: { imageSlot: { src: 'https://placehold.co/1200x800', alt: 'A described image' } } },
    ]);
    assert.ok(found.includes('placeholder-image'));
  });

  it('flags four or more shouted words', () => {
    assert.ok(codes([{ id: 'h', args: { titleSlot: 'BUY NOW BEFORE ITS GONE' } }]).includes('shouting'));
  });

  /** Acronyms and short button labels are not shouting; flagging them would make the report ignorable. */
  it('leaves acronyms and short labels alone', () => {
    assert.ok(!codes([{ id: 'h', args: { titleSlot: 'FAQ' } }]).includes('shouting'));
    assert.ok(!codes([{ id: 'h', args: { titleSlot: 'GET A DEMO' } }]).includes('shouting'));
    assert.ok(!codes([{ id: 'h', args: { titleSlot: 'Compliant with FERPA and HIPAA rules' } }]).includes('shouting'));
  });
});

describe('auditBuild — accessibility', () => {
  it('finds an image with no alt text', () => {
    const found = auditBuild([{ id: 'h', args: { imageSlot: { src: '/real.png', alt: '' } } }] as never, []);
    assert.equal(found.filter((f) => f.code === 'missing-alt').length, 1);
    assert.equal(found.find((f) => f.code === 'missing-alt')?.category, 'accessibility');
  });

  it('accepts an image that has alt text', () => {
    assert.ok(!codes([{ id: 'h', args: { imageSlot: { src: '/real.png', alt: 'Students on campus' } } }]).includes('missing-alt'));
  });

  it('flags link text that describes nothing', () => {
    assert.ok(codes([{ id: 'h', args: { buttonSlot: 'click here' } }]).includes('weak-link-text'));
  });

  it('accepts link text that names the destination', () => {
    assert.ok(!codes([{ id: 'h', args: { buttonSlot: 'Book a demo' } }]).includes('weak-link-text'));
  });
});

describe('auditBuild — seo', () => {
  it('reports substantial copy repeated across blocks, once, against the later one', () => {
    const line = 'Connect every department classroom and student securely';
    const found = auditBuild(
      [
        { id: 'a', args: { bodySlot: line } },
        { id: 'b', args: { bodySlot: line } },
      ] as never,
      []
    );
    const repeats = found.filter((f) => f.code === 'repeated-copy');
    assert.equal(repeats.length, 1);
    assert.equal(repeats[0].blockIndex, 1);
  });

  /** Short labels repeat legitimately all over a page — a CTA on every section is not duplicate content. */
  it('ignores short repeated labels', () => {
    const found = codes([
      { id: 'a', args: { buttonSlot: 'Book a demo' } },
      { id: 'b', args: { buttonSlot: 'Book a demo' } },
    ]);
    assert.ok(!found.includes('repeated-copy'));
  });

  it('reports a page with almost no words', () => {
    const found = auditBuild([{ id: 'h', args: { titleSlot: 'Hello' } }] as never, []);
    const thin = found.find((f) => f.code === 'thin-content');
    assert.ok(thin);
    // Page-level: it belongs to no single block, so a UI must not try to link it to one.
    assert.equal(thin!.blockIndex, null);
    assert.equal(thin!.path, null);
  });

  it('does not report thin content on a page with real copy', () => {
    // Comfortably over the 30-word floor: the check is meant to catch a page nobody has written yet, not a
    // short section, so the fixture has to be a plausible page's worth of words.
    const body =
      'One unified cloud phone system for administration, faculty, security and student life across every campus ' +
      'building and remote site. It integrates with the tools you already run and scales from a single department ' +
      'to a multi-campus university without new hardware.';
    assert.ok(!codes([{ id: 'h', args: { bodySlot: body } }]).includes('thin-content'));
  });
});

describe('auditBuild — plumbing', () => {
  /** Overrides are what the builder actually typed; auditing the template instead would check the wrong text. */
  it('audits the merged args, so overrides are what get checked', () => {
    const blocks = [{ id: 'hero', args: { bodySlot: 'Perfectly fine original copy that is long enough.' } }];
    const withOverride = codes(blocks, [{ bodySlot: 'Lorem ipsum dolor sit amet.' }]);
    assert.ok(withOverride.includes('placeholder-text'));
    assert.ok(!codes(blocks).includes('placeholder-text'));
  });

  it('finds nothing in an empty page', () => {
    assert.deepEqual(auditBuild([], []), []);
  });

  it('groups findings and still lists the categories that found nothing', () => {
    const grouped = groupAuditFindings(auditBuild([{ id: 'h', args: { bodySlot: 'Lorem ipsum here' } }] as never, []));
    assert.ok(grouped.content.length >= 1);
    // `voice` is declared but never produced — it needs an LLM against the brand voice doc, not a regex.
    assert.deepEqual(grouped.voice, []);
    assert.ok(Array.isArray(grouped.seo));
    assert.ok(Array.isArray(grouped.accessibility));
  });
});

/**
 * Alt text is editable text but it is not page copy.
 *
 * Both cases here came from running the audit over real pages: repeated alt on a page reusing one image was
 * reported as duplicate content, and alt words were padding the word count that decides "thin content".
 */
describe('auditBuild — alt text is not page copy', () => {
  it('does not treat repeated alt text as duplicate content', () => {
    const alt = 'Students collaborating at a library table together';
    const found = auditBuild(
      [
        { id: 'a', args: { imageSlot: { src: '/one.png', alt } } },
        { id: 'b', args: { imageSlot: { src: '/two.png', alt } } },
      ] as never,
      []
    );
    assert.equal(found.filter((f) => f.code === 'repeated-copy').length, 0);
  });

  it('does not let alt text pad the word count away from thin content', () => {
    const longAlt = 'A very long and descriptive alternative text about students walking across the campus quad in autumn sunshine together';
    const found = auditBuild([{ id: 'a', args: { imageSlot: { src: '/one.png', alt: longAlt } } }] as never, []);
    assert.ok(found.some((f) => f.code === 'thin-content'));
  });

  /** Still audited for the things that do apply to it. */
  it('still flags placeholder copy inside alt text', () => {
    const found = auditBuild([{ id: 'a', args: { imageSlot: { src: '/one.png', alt: 'Lorem ipsum' } } }] as never, []);
    assert.ok(found.some((f) => f.code === 'placeholder-text'));
  });
});
