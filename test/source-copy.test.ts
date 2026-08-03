import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  SOURCE_COPY_ACCEPT,
  SOURCE_COPY_MAX_CHARS,
  countWords,
  frameSourceCopy,
  isReadableTextFile,
  unreadableFileMessage,
} from '../src/app/lib/source-copy';

/**
 * The framing is the feature. A textarea is a textarea; what decides whether supplied copy reaches the
 * page is whether the model is told to use the words rather than interpret them.
 */
describe('frameSourceCopy', () => {
  const copy = 'Phone systems built for campus scale\n\nOne platform for every building.';

  it('tells the model to use the words rather than rewrite them', () => {
    // Without this, twelve paragraphs of approved marketing copy come back as the model's own
    // headlines — which looks finished and is not what anybody signed off.
    const framed = frameSourceCopy(copy)!;
    assert.match(framed.content, /Use these words/);
    assert.match(framed.content, /rather than rewriting them/);
  });

  it('forbids inventing filler for fields the copy does not cover', () => {
    // A page has more slots than a copy doc has sections, and plausible filler is the default.
    assert.match(frameSourceCopy(copy)!.content, /Do not invent copy/);
  });

  it('says it is not a layout — the trap the URL importer fell into', () => {
    assert.match(frameSourceCopy(copy)!.content, /not a layout/);
  });

  it('includes the copy verbatim after a separator', () => {
    const framed = frameSourceCopy(copy)!;
    assert.ok(framed.content.includes(copy), 'the copy itself must survive intact');
    assert.ok(framed.content.indexOf('---') < framed.content.indexOf('Phone systems'));
  });

  it('labels the turn with a word count, not the copy', () => {
    // The transcript must not show hundreds of words the user never typed.
    const framed = frameSourceCopy(copy)!;
    assert.match(framed.label, /Supplied copy \(11 words\)/);
    assert.ok(!framed.label.includes('campus scale'));
  });

  it('names the source when there is one', () => {
    const framed = frameSourceCopy(copy, 'campus-page.md')!;
    assert.match(framed.label, /from campus-page\.md/);
    assert.match(framed.content, /from campus-page\.md/);
  });

  it('returns null for nothing, so an empty paste cannot send a turn', () => {
    assert.equal(frameSourceCopy(''), null);
    assert.equal(frameSourceCopy('   \n\t '), null);
  });

  it('truncates over the cap and says so, rather than silently dropping copy', () => {
    // The transcript is replayed every round of the tool loop — one page composition ran to thirteen —
    // so pasted copy is paid for per round. Silently losing half of it is the failure to avoid.
    const long = `${'word '.repeat(12_000)}`;
    const framed = frameSourceCopy(long)!;
    assert.equal(framed.truncated, true);
    assert.match(framed.content, /longer than we can send/);
    assert.ok(framed.content.length < SOURCE_COPY_MAX_CHARS + 1_000);
  });

  it('does not flag truncation when it fits', () => {
    assert.equal(frameSourceCopy(copy)!.truncated, undefined);
  });

  it('cuts at a paragraph break rather than mid-sentence', () => {
    const head = 'a'.repeat(SOURCE_COPY_MAX_CHARS - 100);
    const framed = frameSourceCopy(`${head}\n\nthis paragraph starts near the limit and runs past it${'!'.repeat(300)}`)!;
    assert.ok(framed.content.trimEnd().endsWith('a'), 'should end at the paragraph break');
  });

  it('still truncates when there is no boundary to cut at', () => {
    // One enormous unbroken line — a CSV column, or copy pasted without newlines.
    const framed = frameSourceCopy('x'.repeat(SOURCE_COPY_MAX_CHARS + 5_000))!;
    assert.equal(framed.truncated, true);
  });
});

describe('isReadableTextFile', () => {
  it('accepts the plain-text formats copy actually arrives in', () => {
    for (const name of ['brief.txt', 'Copy Deck.md', 'notes.markdown', 'rows.csv', 'rows.TSV']) {
      assert.ok(isReadableTextFile(name), name);
    }
  });

  it('refuses binary formats, including .docx — that goes through the converter, not here', () => {
    // Judged by extension, not MIME type: a .docx arrives as a plausible `application/…` and reading it
    // as text would decode to binary noise and send it to the model as if it were copy.
    for (const name of ['deck.docx', 'brief.pdf', 'logo.png', 'sheet.xlsx', 'noextension']) {
      assert.ok(!isReadableTextFile(name), name);
    }
  });
});

/**
 * The first report of this feature was "she can't select a docx" against a deployed build whose picker
 * already listed `.docx`. Extensions alone are what the JS checks; `accept` is a hint to the OS dialog,
 * and an extension-only list is where dialogs get selective about greying files out.
 */
describe('SOURCE_COPY_ACCEPT', () => {
  it('offers every supported extension', () => {
    for (const ext of ['.txt', '.md', '.markdown', '.csv', '.tsv', '.rtf', '.docx']) {
      assert.ok(SOURCE_COPY_ACCEPT.includes(ext), ext);
    }
  });

  it('also offers MIME types, so a dialog can match on either', () => {
    assert.ok(SOURCE_COPY_ACCEPT.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    assert.ok(SOURCE_COPY_ACCEPT.includes('text/plain'));
  });

  it('stays a valid accept list — comma separated, no spaces or empties', () => {
    const parts = SOURCE_COPY_ACCEPT.split(',');
    assert.ok(parts.length > 6);
    for (const part of parts) {
      assert.equal(part, part.trim(), `"${part}" has whitespace`);
      assert.ok(part.length, 'no empty entries');
    }
  });

  it('does not widen what is actually accepted — the extension gates still decide', () => {
    // A dialog offering a .doc or .pdf is harmless; both are refused after selection, with a message.
    assert.ok(!isReadableTextFile('legacy.doc'));
    assert.ok(!isReadableTextFile('brief.pdf'));
  });
});

describe('unreadableFileMessage', () => {
  it('names the format and what to do instead', () => {
    assert.match(unreadableFileMessage('brief.pdf'), /PDFs can't be read yet/);
    assert.match(unreadableFileMessage('brief.pdf'), /paste the copy in instead/);
    assert.match(unreadableFileMessage('thing.xlsx'), /\.xlsx files/);
    assert.match(unreadableFileMessage('thing.xlsx'), /Word \(\.docx\), text, Markdown and CSV files work/);
  });

  it('distinguishes .doc from .docx, which is supported', () => {
    // Claiming "Word documents work" and then failing on the old binary format sends someone round a
    // loop, so the legacy format gets named specifically.
    assert.match(unreadableFileMessage('legacy.doc'), /older \.doc format/);
  });

  it('does not contradict itself for a .docx that failed to convert', () => {
    // `.docx` is supported, so getting here means the conversion failed — a password-protected file
    // most often. The message used to read ".docx files can't be read … Word (.docx) works".
    const message = unreadableFileMessage('deck.docx');
    assert.match(message, /password-protected or corrupt/);
    assert.ok(!/\.docx\) .*work/.test(message), 'must not claim .docx works while refusing one');
  });

  it('copes with a file that has no extension', () => {
    assert.match(unreadableFileMessage('README'), /That format/);
  });
});

describe('countWords', () => {
  it('counts words, tolerating any whitespace', () => {
    assert.equal(countWords('one two  three\nfour\tfive'), 5);
    assert.equal(countWords(''), 0);
    assert.equal(countWords('  \n '), 0);
  });
});
