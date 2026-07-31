import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseCanvasBlocks, summarizeComposition } from '../src/app/lib/composition-summary';

/**
 * Sent with every follow-up turn, so it is paid for on every round of the tool loop. It has to say
 * enough for "make the hero shorter" to resolve, and no more.
 */
describe('summarizeComposition', () => {
  it('is empty for an empty canvas, so no context block is added at all', () => {
    assert.equal(summarizeComposition([]), '');
  });

  it('numbers blocks and quotes their leading copy', () => {
    const out = summarizeComposition([
      { componentId: 'hero-split', args: { title: 'One platform. Every conversation.' } },
      { componentId: 'pricing', args: { heading: 'Plans built for how you work' } },
    ]);
    assert.match(out, /1\. hero-split — "One platform\. Every conversation\."/);
    assert.match(out, /2\. pricing/);
  });

  it('strips markup, since richtext args would otherwise put HTML in the prompt', () => {
    const out = summarizeComposition([{ componentId: 'cta', args: { body: '<p>Start your <b>free</b> trial</p>' } }]);
    assert.match(out, /"Start your free trial"/);
    assert.doesNotMatch(out, /</);
  });

  it('handles a block with no text at all', () => {
    const out = summarizeComposition([{ componentId: 'logo-cloud', args: { dark: true, columns: 4 } }]);
    assert.equal(out, '1. logo-cloud');
  });

  it('tolerates missing args', () => {
    assert.equal(summarizeComposition([{ componentId: 'divider' }]), '1. divider');
  });

  it('truncates long copy — this is a label, not the content', () => {
    const out = summarizeComposition([{ componentId: 'hero', args: { title: 'x'.repeat(500) } }]);
    assert.ok(out.length < 120);
  });
});

/**
 * The route accepted `{ messages, attachedAssetIds }` and the client sent `currentBlocks`, so the
 * canvas was dropped on the floor: the chat asked "which hero do you mean?" about a page with one
 * hero on it. Nothing failed to compile, because an unread property is not a type error. These tests
 * exist so the parse has a name that can be searched for and a contract that can break loudly.
 */
describe('parseCanvasBlocks', () => {
  it('reads the canvas the client actually sends', () => {
    const blocks = parseCanvasBlocks([
      { componentId: 'hero-split', args: { titleSlot: 'Connect your people' } },
      { componentId: 'stats-band', args: {} },
    ]);
    assert.deepEqual(blocks, [
      { componentId: 'hero-split', args: { titleSlot: 'Connect your people' } },
      { componentId: 'stats-band', args: {} },
    ]);
  });

  it('survives the canvas being absent, so a first turn still works', () => {
    assert.deepEqual(parseCanvasBlocks(undefined), []);
    assert.deepEqual(parseCanvasBlocks(null), []);
    assert.deepEqual(parseCanvasBlocks('hero-split'), []);
  });

  it('drops entries with no component id rather than summarising "undefined"', () => {
    const blocks = parseCanvasBlocks([{ args: { a: 1 } }, null, 7, { componentId: '' }, { componentId: 'ok' }]);
    assert.deepEqual(blocks, [{ componentId: 'ok', args: {} }]);
  });

  it('defaults non-object args to {}, since they are indexed by the summariser', () => {
    assert.deepEqual(parseCanvasBlocks([{ componentId: 'a', args: ['x'] }]), [{ componentId: 'a', args: {} }]);
    assert.deepEqual(parseCanvasBlocks([{ componentId: 'a', args: 'x' }]), [{ componentId: 'a', args: {} }]);
  });

  it('feeds the summariser, which is the only reason it exists', () => {
    const summary = summarizeComposition(
      parseCanvasBlocks([{ componentId: 'hero-split', args: { titleSlot: '<p>Connect your people</p>' } }])
    );
    assert.equal(summary, '1. hero-split — "Connect your people"');
  });
});
