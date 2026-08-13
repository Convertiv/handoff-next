import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { INLINE_EDIT_CSS, inlineEditScript } from '../src/app/components/Playground/inline-edit-script';
import { getLinkGuardScript } from '../src/app/components/Playground/link-guard-script';

/**
 * The injected canvas scripts, driven against a real DOM.
 *
 * These two modules emit **strings**, and a string is invisible to the compiler: `tsc` has never checked a line of
 * what runs inside the preview frame. That has cost real bugs — an unescaped backtick that terminated the template,
 * and a `setSelectionRange` call left on a `<div>` that threw before the editor state was assigned, so richtext
 * inline editing appeared to work and committed nothing. Both shipped green.
 *
 * So the emitted script is executed here, against jsdom, with the parent's `postMessage` captured. jsdom has no
 * layout engine, which is why geometry is stubbed — the overlay only needs *a* box, not the right one, for
 * everything these tests assert.
 */

/** One block with an editable heading, a richtext body, links and a form; a second block to scroll to. */
const BODY = `
<div class="playground-block" data-block-id="b1" data-block-title="Hero">
  <h1><!--hf:title-->A headline that is quite long indeed<!--/hf:title--></h1>
  <div class="body"><!--hf:body--><p>Some <strong>rich</strong> copy.</p><!--/hf:body--></div>
  <a href="https://example.com/away">Go away</a>
  <a href="#section">In page</a>
  <form action="https://example.com/search"><button type="submit">Search</button></form>
</div>
<div class="playground-block" data-block-id="b2" data-block-title="Second">
  <h2><!--hf:title-->Second block title<!--/hf:title--></h2>
</div>`;

interface Canvas {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  w: any;
  doc: Document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posted: any[];
  /** What `scrollIntoView` was called on, as `TAG:text` — jsdom cannot scroll, so it is recorded instead. */
  scrolled: string[];
  overlay: () => HTMLElement | null;
}

function canvas(script: string, { linkGuard = true } = {}): Canvas {
  const dom = new JSDOM(`<html><head><style>${INLINE_EDIT_CSS}</style></head><body>${BODY}</body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = dom.window as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posted: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  w.parent = { postMessage: (m: any) => posted.push(m) };

  const scrolled: string[] = [];
  const RECT = { left: 10, top: 20, width: 240, height: 32, right: 250, bottom: 52, x: 10, y: 20, toJSON() {} };
  w.Range.prototype.getBoundingClientRect = () => RECT;
  w.Range.prototype.getClientRects = () => [RECT];
  w.Element.prototype.getBoundingClientRect = () => RECT;
  w.Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(`${this.tagName}:${(this.textContent || '').trim().slice(0, 20)}`);
  };

  w.eval(script);
  if (linkGuard) w.eval(getLinkGuardScript());

  return {
    w,
    doc: w.document as Document,
    posted,
    scrolled,
    overlay: () => w.document.querySelector('.hf-overlay-rich') as HTMLElement | null,
  };
}

/** The editable page canvas: `title` is plain text, `body` is richtext, and `title` is capped at 20. */
const editable = () => canvas(inlineEditScript({ b1: { title: 20 } }, ['title'], ['body']));
/** The review canvas: marks are collected and navigable, nothing is editable. */
const readOnly = () => canvas(inlineEditScript({}, [], []));

describe('inline editing — the overlay', () => {
  let c: Canvas;
  beforeEach(() => {
    c = editable();
  });

  it('marks an editable field as a hit area and opens on click', () => {
    const h1 = c.doc.querySelector('h1')!;
    assert.ok(h1.classList.contains('hf-field-hit'));
    h1.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    assert.ok(c.overlay());
  });

  it('edits in a contenteditable, not a textarea', () => {
    // A textarea is a fixed box that scrolls its own content, so long copy wrapped out of sight while it was
    // being typed — the QA complaint this replaced.
    c.doc.querySelector('h1')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    const ov = c.overlay()!;
    assert.equal(c.doc.querySelectorAll('textarea').length, 0);
    assert.equal(ov.getAttribute('contenteditable'), 'plaintext-only');
    assert.equal(ov.textContent, 'A headline that is quite long indeed');
    // No fixed height: the box grows with the text.
    assert.equal(ov.style.height, '');
    assert.ok(ov.style.minHeight);
  });

  it('reports focus, which means the editor state was actually assigned', () => {
    // Regression: `setSelectionRange` on a div threw here, leaving `open` null — so every richtext edit was
    // silently discarded. The symptom was "richtext editing does nothing", three layers from the cause.
    c.doc.querySelector('h1')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    assert.ok(c.posted.some((m) => m.type === 'playground-field-focus'));
  });

  it('commits a text field as words, never as markup', () => {
    c.doc.querySelector('h1')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    const ov = c.overlay()!;
    ov.textContent = 'Shorter headline';
    ov.dispatchEvent(new c.w.FocusEvent('blur'));
    const commit = c.posted.find((m) => m.type === 'playground-field-commit');
    assert.equal(commit.value, 'Shorter headline');
    assert.equal(commit.fieldId, 'title');
  });

  it('commits a richtext field with its markup intact', () => {
    c.doc.querySelector('.body')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    const ov = c.overlay()!;
    assert.equal(ov.getAttribute('contenteditable'), 'true');
    assert.match(ov.innerHTML, /<strong>rich<\/strong>/);
    ov.innerHTML = '<p>Some <strong>bolder</strong> copy.</p>';
    ov.dispatchEvent(new c.w.FocusEvent('blur'));
    const commit = [...c.posted].reverse().find((m) => m.type === 'playground-field-commit');
    assert.match(commit.value, /<strong>bolder<\/strong>/);
  });

  it('counts copy against the block’s own limit', () => {
    c.doc.querySelector('h1')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    const meta = c.doc.querySelector('.hf-overlay-meta')!;
    assert.match(meta.textContent!, /36\/20/);
    assert.equal(meta.getAttribute('data-over'), '1');
  });
});

describe('inline editing — a canvas with nothing editable', () => {
  it('offers no affordance at all', () => {
    const c = readOnly();
    assert.equal(c.doc.querySelectorAll('.hf-field-hit').length, 0);
    c.doc.querySelector('h1')!.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    assert.equal(c.overlay(), null);
  });

  it('still answers navigation, which is what makes a finding clickable on the review canvas', () => {
    const c = readOnly();
    c.w.dispatchEvent(new c.w.MessageEvent('message', { data: { type: 'playground-scroll-to-block', blockId: 'b2' } }));
    assert.ok(c.scrolled.some((s) => s.startsWith('DIV')));

    c.w.dispatchEvent(
      new c.w.MessageEvent('message', { data: { type: 'playground-highlight-field', fieldId: 'title', reveal: true } })
    );
    // Both blocks have a `title`, and both light up — the rail shows one editor per field, not per row.
    assert.equal(c.doc.querySelectorAll('.hf-field-hit-active').length, 2);
    assert.ok(c.scrolled.some((s) => s.startsWith('H1')));
  });

  it('highlights without scrolling unless asked to reveal', () => {
    // Hover highlights. If hover also scrolled, running the pointer down the rail would throw the page around.
    const c = readOnly();
    c.w.dispatchEvent(new c.w.MessageEvent('message', { data: { type: 'playground-highlight-field', fieldId: 'body' } }));
    assert.equal(c.scrolled.length, 0);
    assert.equal(c.doc.querySelectorAll('.hf-field-hit-active').length, 1);
  });
});

describe('link guard', () => {
  it('stops a click from navigating the canvas away, and says why', () => {
    const c = readOnly();
    const evt = new c.w.MouseEvent('click', { bubbles: true, cancelable: true });
    c.doc.querySelector('a[href^="https"]')!.dispatchEvent(evt);
    assert.ok(evt.defaultPrevented);
    assert.match(c.doc.body.textContent!, /Links are inactive/);
  });

  it('leaves an in-page anchor alone — that is the page working, not leaving', () => {
    const c = readOnly();
    const evt = new c.w.MouseEvent('click', { bubbles: true, cancelable: true });
    c.doc.querySelector('a[href^="#"]')!.dispatchEvent(evt);
    assert.equal(evt.defaultPrevented, false);
  });

  it('stops a form submitting for the same reason', () => {
    const c = readOnly();
    const evt = new c.w.Event('submit', { bubbles: true, cancelable: true });
    c.doc.querySelector('form')!.dispatchEvent(evt);
    assert.ok(evt.defaultPrevented);
  });
});
