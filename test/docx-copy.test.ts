import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { docxToSourceCopy, htmlToSourceCopy, isConvertibleDocument } from '../src/app/lib/docx-copy';

/**
 * The conversion that matters is docx→**structure**, not docx→text.
 *
 * `frameSourceCopy` tells the model to put the supplied headings into matching fields. A flat text dump
 * destroys the signal that instruction depends on — heading and paragraph come out identical, so the
 * model guesses which sentences are headlines, and guessing is the thing being removed.
 *
 * Tested against mammoth's real output rather than invented HTML wherever it matters: two bugs here were
 * only visible end to end. A `<p>` inside a `<td>` lost the cell prefix, and a post-pass that merged
 * consecutive cells ran two table rows together.
 */
describe('htmlToSourceCopy', () => {
  it('keeps heading level, which is what tells a headline from body copy', () => {
    const out = htmlToSourceCopy('<h1>Campus scale</h1><p>One platform.</p><h2>Why us</h2>');
    assert.equal(out, '# Campus scale\n\nOne platform.\n\n## Why us');
  });

  it('numbers an ordered list and bullets an unordered one', () => {
    // A numbered list in a copy deck is usually a sequence the page has to preserve.
    assert.equal(htmlToSourceCopy('<ul><li>A</li><li>B</li></ul>'), '- A\n\n- B');
    assert.equal(htmlToSourceCopy('<ol><li>A</li><li>B</li></ol>'), '1. A\n\n2. B');
  });

  it('handles a nested list, which is what defeats paired-tag matching', () => {
    const out = htmlToSourceCopy('<ul><li>Tier one</li><ol><li>Step</li><li>Step two</li></ol></ul>');
    assert.match(out, /- Tier one/);
    assert.match(out, /1\. Step/);
    assert.match(out, /2\. Step two/);
  });

  it('restarts numbering for a second list', () => {
    const out = htmlToSourceCopy('<ol><li>A</li></ol><p>Break</p><ol><li>B</li></ol>');
    assert.equal(out, '1. A\n\nBreak\n\n1. B');
  });

  it('keeps a table row together and separate from the next row', () => {
    // A post-pass that merged consecutive cells gave `| Section | Copy | Hero | … |` — two rows of a
    // two-column deck run together, destroying the pairing the pipes exist to preserve.
    const out = htmlToSourceCopy(
      '<table><tr><td><p>Section</p></td><td><p>Copy</p></td></tr><tr><td><p>Hero</p></td><td><p>Talk</p></td></tr></table>'
    );
    assert.equal(out, '| Section | Copy |\n\n| Hero | Talk |');
  });

  it('drops inline formatting but keeps every word', () => {
    assert.equal(htmlToSourceCopy('<p>Research <strong>and</strong> <em>teaching</em> connect</p>'), 'Research and teaching connect');
  });

  it('turns a line break into a space rather than gluing words together', () => {
    assert.equal(htmlToSourceCopy('<p>One line<br />Another</p>'), 'One line Another');
  });

  it('decodes entities, ampersand last so nothing double-decodes into a tag', () => {
    assert.equal(htmlToSourceCopy('<p>Research &amp; teaching</p>'), 'Research & teaching');
    assert.equal(htmlToSourceCopy('<p>&amp;lt;not a tag&amp;gt;</p>'), '&lt;not a tag&gt;');
    assert.equal(htmlToSourceCopy('<p>a&nbsp;b &quot;q&quot; &#39;s&#39;</p>'), 'a b "q" \'s\'');
  });

  it('skips empty paragraphs Word litters documents with', () => {
    assert.equal(htmlToSourceCopy('<p>A</p><p></p><p>  </p><p>B</p>'), 'A\n\nB');
  });

  it('falls back to a plain strip rather than returning nothing', () => {
    // Losing the structure is a degraded result; losing the copy is a broken one.
    assert.equal(htmlToSourceCopy('Bare text with <span>a span</span>'), 'Bare text with a span');
  });

  it('returns empty for empty, so an image-only document does not send a blank turn', () => {
    assert.equal(htmlToSourceCopy(''), '');
    assert.equal(htmlToSourceCopy('   '), '');
    assert.equal(htmlToSourceCopy('<img src="x" />'), '');
  });
});

describe('isConvertibleDocument', () => {
  it('accepts .docx, case-insensitively', () => {
    assert.ok(isConvertibleDocument('Copy Deck.docx'));
    assert.ok(isConvertibleDocument('DECK.DOCX'));
  });

  it('refuses .doc — the old binary format mammoth cannot read', () => {
    // Claiming "Word documents work" and then failing on .doc sends someone round a loop.
    assert.ok(!isConvertibleDocument('legacy.doc'));
    assert.ok(!isConvertibleDocument('brief.pdf'));
  });
});

/**
 * End to end through mammoth, against a real zip.
 *
 * The fixture is built by `scripts/make-docx-fixture.mjs` rather than committed as an opaque binary, so
 * what it contains is readable and can be extended. Both bugs above were invisible to hand-written HTML
 * — mammoth's actual output is `<td><p>…</p></td>`, which nobody would think to write by hand.
 */
describe('docxToSourceCopy against a real .docx', () => {
  const fixture = path.join(import.meta.dirname, 'fixtures/copy-deck.docx');

  it('converts a copy deck to structured copy', async () => {
    const buffer = fs.readFileSync(fixture);
    const out = await docxToSourceCopy(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);

    assert.match(out, /^# Phone systems built for campus scale$/m, 'Heading1 becomes #');
    assert.match(out, /^## Why universities choose us$/m, 'Heading2 becomes ##');
    assert.match(out, /^- Runs on the network you already have$/m, 'bulleted list');
    assert.match(out, /^1\. First, audit the lines$/m, 'numbered list starts at 1');
    assert.match(out, /^2\. Then port the numbers$/m);
    assert.match(out, /^\| Section \| Copy \|$/m, 'table row stays one row');
    assert.match(out, /^\| Hero \| Talk to every building \|$/m, 'and the next row is its own');
    assert.match(out, /Research & teaching stay connected\./, 'bold flattened, entity decoded');
  });

  it('produces something a person would recognise as their document', async () => {
    // A guard against a conversion that technically passes every assertion above while emitting noise.
    const buffer = fs.readFileSync(fixture);
    const out = await docxToSourceCopy(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    assert.ok(!out.includes('<'), 'no markup survives');
    assert.ok(!/w:|xmlns/.test(out), 'no XML namespace leakage');
    assert.ok(out.split('\n\n').length >= 8, `expected several blocks, got ${out.split('\n\n').length}`);
  });
});
