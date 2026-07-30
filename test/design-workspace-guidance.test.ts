import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  BRAND_VOICE_FIELD_IDS,
  diffDesignGuidelines,
  mergeBrandVoiceFields,
} from '../src/app/lib/design-workspace-format.ts';

describe('mergeBrandVoiceFields', () => {
  const current = {
    voiceTone: 'Confident, plain-spoken.',
    avoidedPhrases: 'seamless, synergy',
  };

  it('leaves omitted fields alone (patch, not replace)', () => {
    const { merged, changed } = mergeBrandVoiceFields(current, { avoidedPhrases: 'synergy' });
    assert.equal(merged.voiceTone, 'Confident, plain-spoken.');
    assert.equal(merged.avoidedPhrases, 'synergy');
    assert.deepEqual(
      changed.map((c) => [c.field, c.action]),
      [['avoidedPhrases', 'updated']]
    );
  });

  it('reports the overwritten text as before/after', () => {
    const { changed } = mergeBrandVoiceFields(current, { avoidedPhrases: 'synergy' });
    assert.equal(changed[0].before, 'seamless, synergy');
    assert.equal(changed[0].after, 'synergy');
    assert.equal(changed[0].label, 'Avoided Phrases');
    assert.equal(changed[0].truncated, false);
  });

  it('classifies added and cleared fields', () => {
    const { merged, changed } = mergeBrandVoiceFields(current, {
      sampleCopy: 'Get started free',
      avoidedPhrases: '   ',
    });
    const byField = Object.fromEntries(changed.map((c) => [c.field, c.action]));
    assert.equal(byField.sampleCopy, 'added');
    assert.equal(byField.avoidedPhrases, 'cleared');
    // A cleared field is removed rather than stored as an empty string.
    assert.ok(!('avoidedPhrases' in merged));
    assert.equal(merged.sampleCopy, 'Get started free');
  });

  it('treats a whitespace-only difference as unchanged so no write is triggered', () => {
    const { changed, unchanged } = mergeBrandVoiceFields(current, {
      voiceTone: '  Confident, plain-spoken.  ',
    });
    assert.deepEqual(changed, []);
    assert.deepEqual(unchanged, ['voiceTone']);
  });

  it('ignores keys outside the known brand-voice fields', () => {
    const { merged, changed } = mergeBrandVoiceFields(current, {
      // @ts-expect-error — deliberately outside BrandVoiceFieldId
      notAField: 'nope',
    });
    assert.deepEqual(changed, []);
    assert.deepEqual(Object.keys(merged).sort(), ['avoidedPhrases', 'voiceTone']);
  });

  it('covers every field the settings UI exposes', () => {
    const all = Object.fromEntries(BRAND_VOICE_FIELD_IDS.map((id) => [id, `${id} value`]));
    const { changed } = mergeBrandVoiceFields({}, all);
    assert.equal(changed.length, BRAND_VOICE_FIELD_IDS.length);
    assert.ok(changed.every((c) => c.action === 'added'));
  });
});

describe('diffDesignGuidelines', () => {
  it('flags an identical document as unchanged', () => {
    const diff = diffDesignGuidelines('# Rules\n\nUse the grid.', '# Rules\n\nUse the grid.');
    assert.equal(diff.unchanged, true);
    assert.equal(diff.linesAdded, 0);
    assert.equal(diff.linesRemoved, 0);
  });

  it('counts changed lines positionally and shows both sides in the patch', () => {
    const diff = diffDesignGuidelines('a\nb\nc', 'a\nB\nc');
    assert.equal(diff.unchanged, false);
    assert.equal(diff.linesAdded, 1);
    assert.equal(diff.linesRemoved, 1);
    assert.ok(diff.patch.includes('-b'));
    assert.ok(diff.patch.includes('+B'));
    assert.ok(diff.patch.includes(' a'));
  });

  it('keeps the previous document so an overwrite can be restored', () => {
    const diff = diffDesignGuidelines('old guidance', 'new guidance');
    assert.equal(diff.before.text, 'old guidance');
    assert.equal(diff.before.chars, 'old guidance'.length);
    assert.equal(diff.after.text, 'new guidance');
  });

  it('reports zero lines for an empty side', () => {
    const diff = diffDesignGuidelines('', 'first line');
    assert.equal(diff.before.lines, 0);
    assert.equal(diff.after.lines, 1);
    assert.equal(diff.linesRemoved, 0);
    assert.equal(diff.linesAdded, 1);
  });

  it('elides untouched runs and caps a huge rewrite', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 200', 'line 200 CHANGED');

    const diff = diffDesignGuidelines(before, after);
    assert.equal(diff.linesAdded, 1);
    assert.equal(diff.linesRemoved, 1);
    // Only the change plus its context survives, marked by an elision.
    assert.ok(diff.patch.includes('…'));
    assert.ok(diff.patch.split('\n').length < 20);
    assert.equal(diff.patchTruncated, false);

    // A full rewrite has no context to elide, so the patch hits the cap.
    const rewritten = Array.from({ length: 400 }, (_, i) => `fresh ${i}`).join('\n');
    const bigDiff = diffDesignGuidelines(before, rewritten);
    assert.equal(bigDiff.patchTruncated, true);
    assert.equal(bigDiff.patch.split('\n').length, 300);
  });

  it('caps the reported document text but not the stored char count', () => {
    const long = 'x'.repeat(9000);
    const diff = diffDesignGuidelines(long, 'short');
    assert.equal(diff.before.truncated, true);
    assert.ok(diff.before.text.endsWith('…[truncated]'));
    assert.equal(diff.before.chars, 9000);
  });
});
