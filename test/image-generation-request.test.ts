import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildImagePrompt,
  parseSize,
  sizeForDimensions,
  validateImageBrief,
} from '../src/app/lib/image-generation-request';

/**
 * Blocks declare their image dimensions in the property contract, so a hero that wants 16:9 should not
 * get a square photo cropped to fit.
 */
describe('sizeForDimensions', () => {
  it('matches the slot aspect ratio', () => {
    assert.equal(sizeForDimensions({ recommended: { width: 1920, height: 1080 } }), '2048x1152');
    assert.equal(sizeForDimensions({ recommended: { width: 600, height: 600 } }), '1024x1024');
    assert.equal(sizeForDimensions({ recommended: { width: 800, height: 1200 } }), '1024x1536');
    assert.equal(sizeForDimensions({ recommended: { width: 1200, height: 800 } }), '1536x1024');
  });

  it('falls back through recommended, max, min', () => {
    assert.equal(sizeForDimensions({ max: { width: 400, height: 400 } }), '1024x1024');
    assert.equal(sizeForDimensions({ min: { width: 400, height: 600 } }), '1024x1536');
    // recommended wins when several are present.
    assert.equal(
      sizeForDimensions({ recommended: { width: 400, height: 400 }, min: { width: 1920, height: 1080 } }),
      '1024x1024'
    );
  });

  it('defaults to landscape when the block declares nothing usable', () => {
    for (const rules of [null, undefined, {}, { recommended: { width: 0, height: 0 } }]) {
      assert.equal(sizeForDimensions(rules), '1536x1024');
    }
  });

  it('does not skew landscape on mirrored ratios', () => {
    // Comparing raw ratios rather than log-ratios makes "twice as wide" and "half as wide" score
    // differently, and every ambiguous slot ends up landscape.
    assert.equal(sizeForDimensions({ recommended: { width: 300, height: 200 } }), '1536x1024');
    assert.equal(sizeForDimensions({ recommended: { width: 200, height: 300 } }), '1024x1536');
  });

  it('never returns a size the image API would reject', () => {
    const allowed = new Set(['1024x1024', '1536x1024', '1024x1536', '2048x1152']);
    for (const w of [1, 50, 999, 4000]) {
      for (const h of [1, 50, 999, 4000]) {
        assert.ok(allowed.has(sizeForDimensions({ recommended: { width: w, height: h } })));
      }
    }
  });
});

describe('parseSize', () => {
  it('gives the placeholder the same proportions the real image will have', () => {
    assert.deepEqual(parseSize('2048x1152'), [2048, 1152]);
    assert.deepEqual(parseSize('1024x1536'), [1024, 1536]);
  });
});

describe('buildImagePrompt', () => {
  it('always forbids text, the single highest-value line in the prompt', () => {
    const prompt = buildImagePrompt('a nurse using a tablet');
    assert.ok(prompt.includes('a nurse using a tablet'));
    assert.match(prompt, /No text/);
  });

  it('includes house style when the workspace has guidance', () => {
    const prompt = buildImagePrompt('a nurse', 'Warm, natural light. Real people, never stock smiles.');
    assert.match(prompt, /House style to match/);
    assert.ok(prompt.includes('never stock smiles'));
  });

  it('omits the style section entirely when there is none, rather than an empty heading', () => {
    for (const none of [undefined, null, '', '   ']) {
      assert.ok(!buildImagePrompt('a nurse', none).includes('House style'));
    }
  });

  it('clips both inputs — this is paid for on every generation', () => {
    const prompt = buildImagePrompt('x'.repeat(5000), 'y'.repeat(5000));
    assert.ok(!prompt.includes('x'.repeat(1001)));
    assert.ok(!prompt.includes('y'.repeat(601)));
  });
});

describe('validateImageBrief', () => {
  it('accepts a real brief and trims it', () => {
    const r = validateImageBrief('  a nurse using a tablet  ');
    assert.deepEqual(r, { ok: true, brief: 'a nurse using a tablet' });
  });

  it('accepts a short but legitimate subject', () => {
    assert.equal(validateImageBrief('dog').ok, true);
  });

  it('rejects nothing, whitespace, and a stray keystroke', () => {
    for (const bad of [undefined, null, 42, {}, '', '   ', 'd']) {
      const r = validateImageBrief(bad);
      assert.equal(r.ok, false);
      assert.ok(r.ok === false && r.error);
    }
  });

  it('caps length so a pasted document cannot become a prompt', () => {
    const r = validateImageBrief('a'.repeat(9999));
    assert.ok(r.ok && r.brief.length === 1000);
  });
});
