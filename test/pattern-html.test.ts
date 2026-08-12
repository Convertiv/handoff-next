import assert from 'node:assert';
import { describe, it } from 'node:test';
import { composePatternHtml } from '../src/transformers/preview/pattern/html';
import { PREVIEW_HEIGHT_MESSAGE } from '../src/transformers/preview/height-reporter';

/**
 * The pattern detail page frames this document opaque-origin (`sandbox="allow-scripts"`, no
 * `allow-same-origin`) so guest-authored content can't reach the viewing admin's session. That makes
 * the height reporter load-bearing rather than cosmetic: it is the *only* way the parent learns how
 * tall the document is, and without it the preview is stuck at its 400px placeholder. Nothing else
 * fails loudly if it goes missing, hence the guard.
 */
describe('composePatternHtml', () => {
  const fragment = { componentId: 'button', html: '<html><body><button>Go</button></body></html>' };

  it('injects the height reporter, since the frame cannot be measured from outside', () => {
    const out = composePatternHtml('p1', 'Pattern One', [fragment], '');
    assert.ok(out.includes(PREVIEW_HEIGHT_MESSAGE), 'composed document must post its height out');
    assert.ok(out.indexOf(PREVIEW_HEIGHT_MESSAGE) < out.indexOf('</body>'), 'reporter belongs inside the body');
  });

  it('still composes the fragment body and its stylesheet', () => {
    const out = composePatternHtml('p1', 'Pattern One', [fragment], '');
    assert.ok(out.includes('<button>Go</button>'));
    assert.ok(out.includes('/api/component/button.css'));
  });

  it('escapes the title', () => {
    const out = composePatternHtml('p1', '<script>alert(1)</script>', [fragment], '');
    assert.ok(!out.includes('<title><script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });
});
