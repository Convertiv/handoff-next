import assert from 'node:assert';
import { describe, it } from 'node:test';
import { summarizeComposition } from '../src/app/lib/composition-summary';

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
