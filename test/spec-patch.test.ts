import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  applySpecPatch,
  buildPatchPrompt,
  parsePatchResponse,
  specForPatching,
} from '../src/app/lib/spec/patch';
import type { ComponentSpec } from '../src/app/lib/server/design-spec-types';

function spec(): ComponentSpec {
  return {
    version: 1,
    generatedAt: '2026-07-29T00:00:00.000Z',
    overview: { name: 'Hero', description: 'd', type: 'template', designSystemGroup: 'Marketing', summary: 's' },
    variants: [{ key: 'default', name: 'Default', description: 'std', isDefault: true }],
    props: [{ name: 'headline', type: 'string', required: true, description: 'h' }],
    behavior: { interactions: [], transitions: [], edgeCases: [] },
    accessibility: { ariaRole: 'region', requiredAriaAttributes: [], keyboardNav: [], screenReaderNotes: '', wcagTarget: 'AA' },
    content: {
      textInventory: [
        { text: 'Build your AI agent', role: 'heading', location: 'left', editable: true },
        { text: 'Save your seat', role: 'button', location: 'left', editable: true },
      ],
      copyFromPrompt: [],
      rules: [],
    },
    implementation: { existingComponentMatches: [], dependencies: [], cssNotes: 'two col', developerHints: [] },
    tokens: { colors: [], typography: [], spacing: [], radii: [], coverage: 1, notes: 'perfect' },
    reuse: { candidates: [], patterns: [], compositionScore: 0.9, recommendation: 'compose' },
    voice: { findings: [], bannedPhrasesFound: [], score: 0.95, summary: 'good' },
  } as ComponentSpec;
}

describe('specForPatching', () => {
  it('strips derived sections so a tweak cannot rewrite its own report card', () => {
    const editable = specForPatching(spec()) as Record<string, unknown>;
    assert.equal(editable.tokens, undefined);
    assert.equal(editable.reuse, undefined);
    assert.equal(editable.voice, undefined);
  });

  it('keeps the authored sections', () => {
    const editable = specForPatching(spec()) as Record<string, unknown>;
    for (const k of ['overview', 'variants', 'props', 'content', 'behavior', 'accessibility', 'implementation']) {
      assert.ok(editable[k], `missing ${k}`);
    }
  });
});

describe('buildPatchPrompt', () => {
  const p = buildPatchPrompt({ spec: spec(), request: 'shorten the headline' });

  it('carries the request and the editable spec', () => {
    assert.match(p, /shorten the headline/);
    assert.match(p, /Build your AI agent/);
  });

  it('does not send derived sections', () => {
    assert.doesNotMatch(p, /"compositionScore"/);
    assert.doesNotMatch(p, /"bannedPhrasesFound"/);
  });

  it('teaches the three targets, including that unsure is a valid answer', () => {
    assert.match(p, /"unsure"/);
    assert.match(p, /Choosing "unsure" is CORRECT when the request is genuinely ambiguous/);
    assert.match(p, /a wrong silent edit is worse than a question/);
  });

  it('forbids editing derived sections explicitly', () => {
    assert.match(p, /NEVER include tokens, reuse, voice/);
  });

  it('requires complete section values, since a fragment would delete the rest', () => {
    assert.match(p, /COMPLETE replacement value/);
  });

  it('asks for minimal change so review stays small', () => {
    assert.match(p, /Change the MINIMUM necessary/);
  });

  it('includes brand voice only when supplied', () => {
    assert.doesNotMatch(p, /## Brand voice guidelines/);
    assert.match(buildPatchPrompt({ spec: spec(), request: 'x', brandVoice: 'Be direct.' }), /## Brand voice guidelines/);
  });
});

describe('parsePatchResponse', () => {
  const good = JSON.stringify({
    target: 'spec',
    reasoning: 'Copy change.',
    sections: ['content'],
    patch: { content: { textInventory: [{ text: 'Build AI agents', role: 'heading', location: 'left', editable: true }], copyFromPrompt: [], rules: [] } },
    changeSummary: 'Shortened the headline',
  });

  it('accepts a well-formed spec patch', () => {
    const r = parsePatchResponse(good);
    assert.equal(r.ok, true);
    assert.equal(r.response?.target, 'spec');
    assert.deepEqual(r.response?.sections, ['content']);
    assert.equal(r.response?.changeSummary, 'Shortened the headline');
  });

  it('tolerates a fenced code block', () => {
    assert.equal(parsePatchResponse('```json\n' + good + '\n```').ok, true);
  });

  it('rejects non-JSON and non-objects without throwing', () => {
    assert.equal(parsePatchResponse('not json').ok, false);
    assert.equal(parsePatchResponse('"a string"').ok, false);
  });

  it('rejects an unknown target', () => {
    assert.equal(parsePatchResponse(JSON.stringify({ target: 'whatever', patch: {} })).ok, false);
  });

  it('strips derived sections and REPORTS the rejection rather than silently dropping it', () => {
    const r = parsePatchResponse(
      JSON.stringify({
        target: 'spec',
        sections: ['content', 'tokens'],
        patch: { content: { textInventory: [], copyFromPrompt: [], rules: [] }, tokens: { coverage: 1 } },
        changeSummary: 'x',
      })
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.response?.sections, ['content']);
    assert.ok(r.rejectedSections?.some((s) => s.startsWith('tokens')));
    assert.ok(r.rejectedSections?.some((s) => s.includes('derived')));
  });

  it('strips unknown sections too', () => {
    const r = parsePatchResponse(
      JSON.stringify({ target: 'spec', patch: { content: { textInventory: [] }, nonsense: 1 }, changeSummary: 'x' })
    );
    assert.ok(r.rejectedSections?.some((s) => s.includes('unknown section')));
  });

  it('fails a spec patch that changes nothing editable', () => {
    const r = parsePatchResponse(JSON.stringify({ target: 'spec', patch: { tokens: { coverage: 0 } }, changeSummary: 'x' }));
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /no editable sections/);
  });

  it('accepts art-direction and unsure with an empty patch', () => {
    for (const target of ['art-direction', 'unsure']) {
      const r = parsePatchResponse(
        JSON.stringify({ target, reasoning: 'r', patch: {}, changeSummary: 's', cannotApply: 'needs a visual change' })
      );
      assert.equal(r.ok, true, target);
      assert.equal(r.response?.cannotApply, 'needs a visual change');
    }
  });
});

describe('applySpecPatch', () => {
  it('replaces a section wholesale, so removals actually remove', () => {
    const next = applySpecPatch(spec(), {
      content: { textInventory: [{ text: 'Only one', role: 'heading', location: 'left', editable: true }], copyFromPrompt: [], rules: [] },
    } as Partial<ComponentSpec>);
    assert.equal(next.content.textInventory.length, 1);
    assert.equal(next.content.textInventory[0].text, 'Only one');
  });

  it('leaves untouched sections alone', () => {
    const next = applySpecPatch(spec(), { overview: { ...spec().overview, name: 'NewName' } } as Partial<ComponentSpec>);
    assert.equal(next.overview.name, 'NewName');
    assert.deepEqual(next.props, spec().props);
  });

  it('never mutates the input, so the caller still has the previous version to diff', () => {
    const before = spec();
    applySpecPatch(before, { overview: { ...before.overview, name: 'Changed' } } as Partial<ComponentSpec>);
    assert.equal(before.overview.name, 'Hero');
  });

  it('ignores derived sections even if they reach it', () => {
    const next = applySpecPatch(spec(), { tokens: { colors: [], typography: [], spacing: [], radii: [], coverage: 0, notes: 'faked' } } as Partial<ComponentSpec>);
    assert.equal(next.tokens?.coverage, 1);
    assert.equal(next.tokens?.notes, 'perfect');
  });

  it('refreshes generatedAt, since the spec no longer matches when it was generated', () => {
    const next = applySpecPatch(spec(), { overview: { ...spec().overview, name: 'X' } } as Partial<ComponentSpec>);
    assert.notEqual(next.generatedAt, '2026-07-29T00:00:00.000Z');
  });
});
