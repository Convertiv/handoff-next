import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildVoicePrompt, collectPageCopy, parseVoiceFindings } from '../src/app/lib/server/voice-audit';

/**
 * The `voice` audit — E.10's deliberately-empty category, filled.
 *
 * The tests are all on `parseVoiceFindings`, because that is the part that **must not trust the model**. Prompt
 * wording is a judgement call and asserting on it would pin prose; taking a hallucinated field path and rendering a
 * row that jumps nowhere is a defect.
 */
const blocks = [
  { id: 'hero', args: { title: 'Navigate the Landscape', paragraph: 'We revolutionize synergy.' } },
  // Shares `title` with block 0 on purpose — that collision is the bug this file guards.
  { id: 'cta', args: { title: 'Ready to get started?', label: 'Click here' } },
];
const copy = collectPageCopy(blocks, []);

describe('collectPageCopy', () => {
  it('finds every authored string with its block and path', () => {
    assert.deepEqual(
      copy.map((c) => [c.blockIndex, c.path]),
      [
        [0, 'title'],
        [0, 'paragraph'],
        [1, 'title'],
        [1, 'label'],
      ]
    );
  });
});

describe('parseVoiceFindings', () => {
  it('keeps a finding that names a real field, and places it', () => {
    const out = parseVoiceFindings(
      JSON.stringify({ findings: [{ ref: '0.paragraph', message: '“revolutionize” is on the avoid list.' }] }),
      copy
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].category, 'voice');
    assert.equal(out[0].blockIndex, 0);
    assert.equal(out[0].path, 'paragraph');
    assert.match(out[0].message, /revolutionize/);
  });

  /** The defect this exists to prevent: a row that jumps nowhere. */
  it('drops a hallucinated ref rather than rendering it', () => {
    const out = parseVoiceFindings(
      JSON.stringify({ findings: [{ ref: '0.subheadline', message: 'Too long.' }] }),
      copy
    );
    assert.deepEqual(out, []);
  });

  it('drops entries missing a path or a message, and empty messages', () => {
    const out = parseVoiceFindings(
      JSON.stringify({
        findings: [{ message: 'no ref' }, { ref: '0.title' }, { ref: '0.title', message: '   ' }, 'nonsense', null],
      }),
      copy
    );
    assert.deepEqual(out, []);
  });

  /** A model asked for problems will happily list the same field twice. */
  it('reports a field once', () => {
    const out = parseVoiceFindings(
      JSON.stringify({ findings: [{ ref: '1.label', message: 'Vague CTA.' }, { ref: '1.label', message: 'Also vague.' }] }),
      copy
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].message, 'Vague CTA.');
  });

  it('survives junk instead of JSON, and a JSON shape it did not expect', () => {
    assert.deepEqual(parseVoiceFindings('I could not comply.', copy), []);
    assert.deepEqual(parseVoiceFindings('{"result":"ok"}', copy), []);
    assert.deepEqual(parseVoiceFindings('[]', copy), []);
  });

  it('truncates a runaway message rather than letting it break the row', () => {
    const out = parseVoiceFindings(
      JSON.stringify({ findings: [{ ref: '0.title', message: 'x'.repeat(900) }] }),
      copy
    );
    assert.equal(out[0].message.length, 400);
  });
});

/**
 * ⚠️ Found by running the real prompt over a real two-block page: **a path is not unique**. Two blocks both having
 * `title` is ordinary, and keying findings on path alone silently resolved block 0's title to block 1.
 */
describe('parseVoiceFindings — two blocks with the same field name', () => {
  it('places a finding on the block the model named, not the last one to use that path', () => {
    const first = parseVoiceFindings(JSON.stringify({ findings: [{ ref: '0.title', message: 'Block one.' }] }), copy);
    const second = parseVoiceFindings(JSON.stringify({ findings: [{ ref: '1.title', message: 'Block two.' }] }), copy);
    assert.equal(first[0].blockIndex, 0);
    assert.equal(first[0].componentId, 'hero');
    assert.equal(second[0].blockIndex, 1);
    assert.equal(second[0].componentId, 'cta');
    // Both still report the plain path, which is what the UI links on.
    assert.equal(first[0].path, 'title');
    assert.equal(second[0].path, 'title');
  });
});

describe('collectPageCopy — references are not copy', () => {
  /** A URL is not prose: sending it wastes tokens and invites a confident finding about a working link. */
  it('skips url-ish fields', () => {
    const items = collectPageCopy([{ id: 'cta', args: { label: 'Talk to Us', url: 'https://ssctech.com', button: { href: '/x' } } }], []);
    assert.deepEqual(items.map((c) => c.path), ['label']);
  });
});

describe('buildVoicePrompt', () => {
  it('sends only the brand-voice fields that were written', () => {
    const { user } = buildVoicePrompt(copy, { voiceTone: 'Confident.', avoidedPhrases: 'revolutionize', unused: '' });
    assert.match(user, /voiceTone/);
    assert.match(user, /avoidedPhrases/);
    assert.doesNotMatch(user, /unused/);
  });

  it('gives the model the exact refs it must quote back', () => {
    const { user } = buildVoicePrompt(copy, { voiceTone: 'Confident.' });
    for (const c of copy) assert.ok(user.includes(`ref: ${c.ref}`), `missing ${c.ref}`);
  });

  it('says an empty result is correct, so a clean page is not padded with invented findings', () => {
    const { system } = buildVoicePrompt(copy, { voiceTone: 'Confident.' });
    assert.match(system, /empty list/i);
  });
});
