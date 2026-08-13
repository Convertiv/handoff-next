import assert from 'node:assert';
import { describe, it } from 'node:test';
import { changeDigest } from '../src/app/lib/change-digest';
import type { BlockDiff } from '../src/app/lib/guest-editable';

/**
 * The change digest (reflow R.6b) — "what changed" as a sentence, above the field list that proves it.
 *
 * The property that matters is that the sentence and the list can never disagree: both come from the same
 * `BlockDiff[]`. What is tested here is the *prose*, because a summary people quote has to read like something
 * a person would say.
 */

const change = (label: string, kind: 'text' | 'image' = 'text', to = 'new', from = 'old') => ({
  label,
  path: label.toLowerCase(),
  from,
  to,
  kind,
});

const diff = (...blocks: { changes: ReturnType<typeof change>[] }[]): BlockDiff[] =>
  blocks.map((b, i) => ({ componentId: `block_${i}`, index: i, changes: b.changes })) as BlockDiff[];

describe('changeDigest', () => {
  it('says nothing when nothing changed', () => {
    const d = changeDigest(diff({ changes: [] }, { changes: [] }));
    assert.equal(d.sentence, '');
    assert.equal(d.blocksChanged, 0);
    assert.equal(d.blocksTotal, 2);
  });

  it('counts one edit as one', () => {
    const d = changeDigest(diff({ changes: [change('Title')] }, { changes: [] }));
    // Not "1 titles", and not "across 1 blocks".
    assert.equal(d.sentence, '1 title changed, across 1 block.');
  });

  it('groups by label, because that is how a person describes a page', () => {
    const d = changeDigest(
      diff(
        { changes: [change('Title'), change('Body')] },
        { changes: [change('Title')] },
        { changes: [change('Title'), change('Body')] }
      )
    );
    // Three titles is *three titles*, not three unrelated edits — and "bodies", not "bodys".
    assert.match(d.sentence, /^3 titles and 2 bodies changed/);
    assert.deepEqual(d.byLabel, [
      ['Title', 3],
      ['Body', 2],
    ]);
  });

  it('says “every block” when it means every block', () => {
    const d = changeDigest(diff({ changes: [change('Title')] }, { changes: [change('Body')] }));
    assert.match(d.sentence, /across every block\.$/);
  });

  it('names three groups and totals the rest', () => {
    // A sentence listing eight things is a list wearing a sentence's clothes.
    const d = changeDigest(
      diff({
        changes: [change('Title'), change('Body'), change('Eyebrow'), change('Caption'), change('Footnote')],
      })
    );
    /**
     * Alphabetical among equals, not insertion order: the same page must produce the same sentence however its
     * blocks happen to be arranged. (This expectation was wrong first time — it assumed insertion order.)
     */
    // The three named groups, then the tail — and "and" belongs before the tail, not before the third group.
    assert.equal(d.sentence, '1 body, 1 caption, 1 eyebrow and 2 more changed, across 1 block.');
  });

  it('leaves an acronym alone', () => {
    // "3 CTAs", not "3 ctas".
    const d = changeDigest(diff({ changes: [change('CTA'), change('CTA')] }));
    assert.match(d.sentence, /2 CTAs changed/);
  });

  it('counts images separately from copy', () => {
    const d = changeDigest(diff({ changes: [change('Title'), change('Hero', 'image')] }));
    assert.equal(d.fieldsChanged, 1);
    assert.equal(d.imagesChanged, 1);
  });

  it('flags removed content, which reads differently from an edit', () => {
    const d = changeDigest(diff({ changes: [change('Body', 'text', '   ', 'Some copy')] }));
    assert.equal(d.hasRemovals, true);
    assert.match(d.sentence, /including content removed/);
  });

  it('does not call an addition a removal', () => {
    const d = changeDigest(diff({ changes: [change('Body', 'text', 'Some copy', '')] }));
    assert.equal(d.hasRemovals, false);
    assert.doesNotMatch(d.sentence, /removed/);
  });

  it('produces the same sentence regardless of block order', () => {
    // A summary that moves when nothing moved is one people stop trusting.
    const a = changeDigest(diff({ changes: [change('Body')] }, { changes: [change('Title')] }));
    const b = changeDigest(diff({ changes: [change('Title')] }, { changes: [change('Body')] }));
    assert.equal(a.sentence, b.sentence);
  });

  it('survives a change with no label', () => {
    const d = changeDigest(diff({ changes: [{ ...change('X'), label: '  ' }] }));
    assert.match(d.sentence, /1 field changed/);
  });
});
