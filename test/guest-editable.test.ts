import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  applyOverride,
  collectEditableText,
  collectImageSrcs,
  diffSubmissionAgainstTemplate,
  getAtPath,
  humanizeKey,
  mergeBlockArgs,
  setAtPath,
} from '../src/app/lib/guest-editable';

/**
 * Pinned against the shapes that have actually cost debugging time (DEVLOG 2026-07-31): an image slot
 * whose src lives at `props.src` while its descriptor claims `{ src, alt }`, and text wrapped in a `<p>`
 * element node. This module exists to read real values instead of trusting descriptors, so the tests use
 * real values.
 */

/** The hero-background shape from the DEVLOG, trimmed. */
const heroBackground = {
  headline: 'Retirement, handled',
  eyebrow: '',
  desktopImageSlot: {
    key: 'hero-img',
    type: 'img',
    props: { src: '../../images/content/iframe-bg-img.jpeg', width: 2560, height: 1400, className: 'w-full' },
  },
  bodySlot: { key: 'b', type: 'p', props: { children: 'Plans that fit the people in them.', className: 'lead' } },
};

describe('collectEditableText', () => {
  it('finds text inside element nodes, not just top-level strings', () => {
    const text = collectEditableText(heroBackground);
    const paths = text.map((t) => t.path.join('.'));
    assert.ok(paths.includes('headline'), paths.join(' | '));
    assert.ok(paths.includes('bodySlot.props.children'), paths.join(' | '));
  });

  it('skips structural strings that would break the block', () => {
    const paths = collectEditableText(heroBackground).map((t) => t.path.join('.'));
    for (const bad of ['desktopImageSlot.props.className', 'bodySlot.props.className', 'desktopImageSlot.type']) {
      assert.ok(!paths.includes(bad), `${bad} must not be offered as editable text`);
    }
  });

  it('skips image paths and bare URLs', () => {
    const paths = collectEditableText(heroBackground).map((t) => t.path.join('.'));
    assert.ok(!paths.includes('desktopImageSlot.props.src'));
    assert.deepEqual(collectEditableText({ link: 'https://example.com/page' }), []);
    assert.deepEqual(collectEditableText({ img: 'data:image/png;base64,AAAA' }), []);
  });

  it('skips empty strings — an empty slot has nothing to label', () => {
    assert.ok(!collectEditableText(heroBackground).some((t) => t.path.join('.') === 'eyebrow'));
    assert.deepEqual(collectEditableText({ a: '   ' }), []);
  });

  it('walks arrays of items', () => {
    const args = { cards: [{ title: 'One' }, { title: 'Two' }] };
    assert.deepEqual(
      collectEditableText(args).map((t) => t.path.join('.')),
      ['cards.0.title', 'cards.1.title']
    );
  });

  it('labels from the nearest meaningful key, skipping props/children', () => {
    const body = collectEditableText(heroBackground).find((t) => t.path.join('.') === 'bodySlot.props.children');
    assert.equal(body?.label, 'Body');
  });

  it('drops blobs too long to be a field', () => {
    assert.deepEqual(collectEditableText({ note: 'x'.repeat(2001) }), []);
    assert.equal(collectEditableText({ note: 'x'.repeat(2000) }).length, 1);
  });
});

describe('collectImageSrcs', () => {
  it('finds the src where it really lives, under props', () => {
    const images = collectImageSrcs(heroBackground);
    assert.equal(images.length, 1);
    assert.equal(images[0].src, '../../images/content/iframe-bg-img.jpeg');
    assert.deepEqual(images[0].path, ['desktopImageSlot', 'props', 'src']);
  });

  it('carries native dimensions, which is how a hero is told from a thumbnail', () => {
    const [img] = collectImageSrcs(heroBackground);
    assert.equal(img.width, 2560);
    assert.equal(img.height, 1400);
  });

  it('treats a picture with several sources as one slot', () => {
    // Offering three pickers for one visual image lets a guest change two and see nothing happen.
    const picture = {
      hero: {
        type: 'picture',
        props: {
          children: [
            { type: 'source', props: { src: 'same.jpg' } },
            { type: 'source', props: { src: 'same.jpg' } },
            { type: 'img', props: { src: 'same.jpg' } },
          ],
        },
      },
    };
    assert.equal(collectImageSrcs(picture).length, 1);
  });

  it('finds a plain object-shaped image field too', () => {
    const images = collectImageSrcs({ logo: { src: '/logo.svg', alt: 'Logo' } });
    assert.deepEqual(images[0].path, ['logo', 'src']);
  });

  it('ignores empty srcs', () => {
    assert.deepEqual(collectImageSrcs({ a: { src: '' }, b: { src: '   ' } }), []);
  });
});

describe('setAtPath / getAtPath', () => {
  it('writes without mutating the original', () => {
    const next = setAtPath(heroBackground, ['bodySlot', 'props', 'children'], 'New copy');
    assert.equal(getAtPath(next, ['bodySlot', 'props', 'children']), 'New copy');
    assert.equal(heroBackground.bodySlot.props.children, 'Plans that fit the people in them.');
  });

  it('keeps sibling props intact so the element still renders', () => {
    const next = setAtPath(heroBackground, ['desktopImageSlot', 'props', 'src'], '/new.jpg');
    const props = getAtPath(next, ['desktopImageSlot', 'props']) as Record<string, unknown>;
    assert.equal(props.src, '/new.jpg');
    assert.equal(props.width, 2560, 'width must survive the write');
    assert.equal(props.className, 'w-full');
    assert.equal(getAtPath(next, ['desktopImageSlot', 'type']), 'img', 'element stays an element');
  });

  it('writes into arrays by index', () => {
    const next = setAtPath({ cards: [{ title: 'One' }, { title: 'Two' }] }, ['cards', 1, 'title'], 'Changed');
    assert.deepEqual(next, { cards: [{ title: 'One' }, { title: 'Changed' }] });
  });

  it('returns undefined for a path that does not exist rather than throwing', () => {
    assert.equal(getAtPath(heroBackground, ['nope', 'deeper']), undefined);
    assert.equal(getAtPath(heroBackground, ['headline', 0]), undefined);
  });
});

describe('mergeBlockArgs', () => {
  it('puts guest overrides on top of the template args', () => {
    const merged = mergeBlockArgs({ id: 'hero', args: { headline: 'Template', sub: 'Keep' } }, { headline: 'Guest' });
    assert.deepEqual(merged, { headline: 'Guest', sub: 'Keep' });
  });

  it('tolerates missing or non-object args on either side', () => {
    assert.deepEqual(mergeBlockArgs({ id: 'x' }, null), {});
    assert.deepEqual(mergeBlockArgs({ id: 'x', args: 'nope' }, { a: 1 }), { a: 1 });
  });
});

describe('applyOverride', () => {
  const entry = { id: 'hero-background', args: heroBackground };

  it('writes whole top-level keys so a shallow merge cannot drop element structure', () => {
    // The bug this prevents: a partial `{ desktopImageSlot: { props: { src } } }` override replaces the
    // template's element node on merge, losing type/width/className, and the block stops rendering.
    const override = applyOverride(entry, {}, ['desktopImageSlot', 'props', 'src'], '/new.jpg');
    const slot = override.desktopImageSlot as { type?: string; props?: Record<string, unknown> };
    assert.equal(slot.type, 'img', 'element stays an element');
    assert.equal(slot.props?.src, '/new.jpg');
    assert.equal(slot.props?.width, 2560, 'width survives');
    assert.equal(slot.props?.className, 'w-full');
  });

  it('survives the merge it will actually go through', () => {
    const override = applyOverride(entry, {}, ['bodySlot', 'props', 'children'], 'Guest copy');
    const merged = mergeBlockArgs(entry, override);
    assert.equal(getAtPath(merged, ['bodySlot', 'props', 'children']), 'Guest copy');
    assert.equal(getAtPath(merged, ['bodySlot', 'props', 'className']), 'lead');
    assert.equal(getAtPath(merged, ['headline']), 'Retirement, handled', 'untouched keys still come from the template');
  });

  it('accumulates edits across several keys', () => {
    let override = applyOverride(entry, {}, ['headline'], 'First');
    override = applyOverride(entry, override, ['bodySlot', 'props', 'children'], 'Second');
    const merged = mergeBlockArgs(entry, override);
    assert.equal(merged.headline, 'First');
    assert.equal(getAtPath(merged, ['bodySlot', 'props', 'children']), 'Second');
  });

  it('re-editing the same field replaces rather than nests', () => {
    let override = applyOverride(entry, {}, ['headline'], 'First');
    override = applyOverride(entry, override, ['headline'], 'Second');
    assert.equal(override.headline, 'Second');
    assert.equal(Object.keys(override).length, 1);
  });

  it('ignores an empty path instead of clobbering the override', () => {
    const override = applyOverride(entry, { headline: 'Keep' }, [], 'nope');
    assert.deepEqual(override, { headline: 'Keep' });
  });
});

describe('diffSubmissionAgainstTemplate', () => {
  const templateBlocks = [{ id: 'hero-background', args: heroBackground }];

  it('reports only what the author actually changed', () => {
    const overrides = [
      applyOverride(templateBlocks[0], {}, ['headline'], 'Casey rewrote this'),
    ];
    const [block] = diffSubmissionAgainstTemplate(templateBlocks, templateBlocks, overrides);
    assert.equal(block.changes.length, 1);
    assert.deepEqual(block.changes[0], {
      label: 'Headline',
      path: 'headline',
      from: 'Retirement, handled',
      to: 'Casey rewrote this',
      kind: 'text',
    });
  });

  it('reports an image swap as an image change', () => {
    const overrides = [
      applyOverride(templateBlocks[0], {}, ['desktopImageSlot', 'props', 'src'], '/api/handoff/assets/x/raw'),
    ];
    const [block] = diffSubmissionAgainstTemplate(templateBlocks, templateBlocks, overrides);
    const image = block.changes.find((c) => c.kind === 'image');
    assert.equal(image?.from, '../../images/content/iframe-bg-img.jpeg');
    assert.equal(image?.to, '/api/handoff/assets/x/raw');
  });

  it('reports nothing when the submission matches the template', () => {
    const [block] = diffSubmissionAgainstTemplate(templateBlocks, templateBlocks, [{}]);
    assert.deepEqual(block.changes, []);
  });

  it('shows an added value as a change from empty', () => {
    // The template's `eyebrow` is '' and therefore not an editable field until it has content, so the
    // diff must still surface it once the author fills it in.
    const overrides = [applyOverride(templateBlocks[0], {}, ['eyebrow'], 'New eyebrow')];
    const [block] = diffSubmissionAgainstTemplate(templateBlocks, templateBlocks, overrides);
    const change = block.changes.find((c) => c.path === 'eyebrow');
    assert.equal(change?.from, '');
    assert.equal(change?.to, 'New eyebrow');
  });

  it('diffs against the template as it stands now, not the submission’s own copy', () => {
    // If the template moved on after the draft was seeded, the difference a reviewer cares about is from
    // the current template — so a submission whose own args are stale still reports the delta.
    const movedOn = [{ id: 'hero-background', args: { ...heroBackground, headline: 'Template headline v2' } }];
    const [block] = diffSubmissionAgainstTemplate(templateBlocks, movedOn, [{}]);
    const change = block.changes.find((c) => c.path === 'headline');
    assert.equal(change?.from, 'Template headline v2');
    assert.equal(change?.to, 'Retirement, handled');
  });

  it('tolerates a submission with more blocks than the template', () => {
    const blocks = diffSubmissionAgainstTemplate(
      [...templateBlocks, { id: 'extra', args: { title: 'Added' } }],
      templateBlocks,
      [{}, {}]
    );
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[1].changes, [], 'a block with no template counterpart compares against itself');
  });
});

describe('humanizeKey', () => {
  it('turns slot keys into labels', () => {
    assert.equal(humanizeKey('desktopImageSlot'), 'Desktop Image');
    assert.equal(humanizeKey('headline'), 'Headline');
    assert.equal(humanizeKey('cta_label'), 'Cta label');
    assert.equal(humanizeKey(2), 'Item 3');
  });
});
