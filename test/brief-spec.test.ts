import assert from 'node:assert';
import { describe, it } from 'node:test';
import { briefSpecProblems, buildBriefSpecPrompt, stripMeasuredSections } from '../src/app/lib/spec/brief-spec';
import { buildAssetPrompt, planAssetsFromSpec } from '../src/app/lib/spec/asset-plan';
import type { ComponentSpec } from '../src/app/lib/server/design-spec-types';

const RICH_SUBJECT =
  'A product team gathered around a laptop in a bright open-plan studio, late afternoon window light ' +
  'raking across the desk, warm neutral tones, shallow depth of field with the far wall soft.';

function briefSpec(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    version: 1,
    generatedAt: '2026-07-29T00:00:00.000Z',
    overview: { name: 'Hero', description: 'd', type: 'template', designSystemGroup: 'Marketing', summary: 's' },
    variants: [{ key: 'default', name: 'Default', description: 'std', isDefault: true }],
    props: [],
    behavior: { interactions: [], transitions: [], edgeCases: [] },
    accessibility: { ariaRole: 'region', requiredAriaAttributes: [], keyboardNav: [], screenReaderNotes: '', wcagTarget: 'AA' },
    content: {
      textInventory: [{ text: 'Ship design systems faster', role: 'heading', location: 'left', editable: true }],
      copyFromPrompt: [],
      rules: [],
    },
    implementation: { existingComponentMatches: [], dependencies: [], cssNotes: '', developerHints: [] },
    assetRequirements: [
      { slot: 'backgroundImage', kind: 'photo', subject: RICH_SUBJECT, aspect: '16:9', minWidth: 1600, focalPoint: 'center-right', formats: ['jpeg'] },
    ],
    ...overrides,
  } as ComponentSpec;
}

describe('buildBriefSpecPrompt', () => {
  const p = buildBriefSpecPrompt({
    brief: 'A hero for the developer platform launch',
    copyFromPrompt: ['Book a demo'],
    tokenSummary: 'Colors: brand/primary #04888a',
    brandVoice: 'Direct. No hype.',
    designMd: 'Use 12-column grid.',
    existingComponents: [{ id: 'button', title: 'Button', propsJson: '{}' }],
  });

  it('carries the brief and every context block it was given', () => {
    assert.match(p, /A hero for the developer platform launch/);
    assert.match(p, /Book a demo/);
    assert.match(p, /#04888a/);
    assert.match(p, /Direct\. No hype\./);
    assert.match(p, /12-column grid/);
    assert.match(p, /Button/);
  });

  it('tells the model it is AUTHORING copy, not transcribing it', () => {
    assert.match(p, /You are AUTHORING this component/);
    assert.match(p, /Write the actual copy/);
    assert.doesNotMatch(p, /transcribe/i);
  });

  it('makes brand voice binding on written copy, since the model is the author', () => {
    assert.match(p, /you are WRITING copy/);
    assert.match(p, /must obey the\s+brand voice/);
  });

  it('states that the asset subject IS the generation prompt — the cause of generic imagery', () => {
    assert.match(p, /becomes the image-generation prompt verbatim/);
    assert.match(p, /only thing\s+the image model will see/);
    assert.match(p, /subject, setting, lighting,\s+mood, colour direction/);
  });

  it('still forbids anything structural in the asset subject', () => {
    assert.match(p, /Never mention layout, overlaid text, buttons or surrounding UI/);
  });

  it('forbids the measured sections, which have nothing to measure yet', () => {
    assert.match(p, /Do NOT emit "tokens", "reuse" or "voice"/);
  });

  it('omits context blocks that were not supplied', () => {
    const bare = buildBriefSpecPrompt({ brief: 'x', copyFromPrompt: [] });
    assert.doesNotMatch(bare, /## Brand voice/);
    assert.doesNotMatch(bare, /## Team design guidelines/);
    assert.doesNotMatch(bare, /## Existing components/);
    assert.doesNotMatch(bare, /real tokens/);
  });
});

describe('stripMeasuredSections', () => {
  it('removes tokens, reuse and voice if the model emitted them anyway', () => {
    const withMeasures = briefSpec({
      tokens: { colors: [], typography: [], spacing: [], radii: [], coverage: 1, notes: 'perfect' },
      reuse: { candidates: [], patterns: [], compositionScore: 1, recommendation: 'x' },
      voice: { findings: [], bannedPhrasesFound: [], score: 1, summary: 'x' },
    } as Partial<ComponentSpec>);
    const out = stripMeasuredSections(withMeasures) as Record<string, unknown>;
    assert.equal(out.tokens, undefined);
    assert.equal(out.reuse, undefined);
    assert.equal(out.voice, undefined);
    assert.ok(out.content);
  });
});

describe('briefSpecProblems', () => {
  it('accepts a usable spec', () => {
    assert.deepEqual(briefSpecProblems(briefSpec()), []);
  });

  it('rejects a null spec rather than proceeding', () => {
    assert.equal(briefSpecProblems(null).length, 1);
  });

  it('rejects a spec with no content — it would render an empty design', () => {
    const empty = briefSpec({ content: { textInventory: [], copyFromPrompt: [], rules: [] } } as Partial<ComponentSpec>);
    assert.ok(briefSpecProblems(empty).some((p) => /declares nothing to display/.test(p)));
  });

  it('rejects a thin asset subject, the documented cause of generic imagery', () => {
    const thin = briefSpec({
      assetRequirements: [{ slot: 'hero', kind: 'photo', subject: 'a team collaborating', aspect: '16:9', minWidth: 1600, formats: ['jpeg'] }],
    } as Partial<ComponentSpec>);
    const problems = briefSpecProblems(thin);
    assert.ok(problems.some((p) => /too thin a subject/.test(p)));
    // The offending text is quoted so the failure is actionable rather than abstract.
    assert.ok(problems.some((p) => /a team collaborating/.test(p)));
  });

  it('names the slot that is broken', () => {
    const noSubject = briefSpec({
      assetRequirements: [{ slot: 'sideImage', kind: 'photo', subject: '', aspect: '1:1', minWidth: 400, formats: ['png'] }],
    } as Partial<ComponentSpec>);
    assert.ok(briefSpecProblems(noSubject).some((p) => p.includes('sideImage')));
  });

  it('accepts a spec that declares no imagery at all', () => {
    assert.deepEqual(briefSpecProblems(briefSpec({ assetRequirements: [] } as Partial<ComponentSpec>)), []);
  });
});

describe('buildAssetPrompt palette guidance', () => {
  const req = briefSpec().assetRequirements![0];

  it('adds colour direction when a palette is supplied', () => {
    const p = buildAssetPrompt(req, { palette: ['brand/primary (#04888a)', 'neutral/900 (#111)'] });
    assert.match(p, /Colour direction/);
    assert.match(p, /#04888a/);
  });

  it('tells the model to inform the ambient palette, not paint swatches', () => {
    const p = buildAssetPrompt(req, { palette: ['brand/primary (#04888a)'] });
    assert.match(p, /do not paint literal swatches or tint the whole image/);
  });

  it('caps the palette so it cannot crowd out the subject', () => {
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const p = buildAssetPrompt(req, { palette: many });
    assert.ok(p.includes('c5'));
    assert.ok(!p.includes('c6'), 'palette should be capped at 6 entries');
  });

  it('omits the line entirely with no palette, rather than emitting an empty instruction', () => {
    assert.doesNotMatch(buildAssetPrompt(req), /Colour direction/);
  });

  it('keeps every existing hard constraint', () => {
    const p = buildAssetPrompt(req, { palette: ['x'] });
    assert.match(p, /NO text, letters, numbers/);
    assert.match(p, /NO user-interface elements/);
    assert.match(p, /NO collage/);
  });
});

describe('planAssetsFromSpec threads the palette through', () => {
  it('applies the palette to every planned job', () => {
    const jobs = planAssetsFromSpec(briefSpec(), { palette: ['brand/primary (#04888a)'] });
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].prompt, /#04888a/);
  });

  it('still works with no palette', () => {
    const jobs = planAssetsFromSpec(briefSpec());
    assert.equal(jobs.length, 1);
    assert.doesNotMatch(jobs[0].prompt, /Colour direction/);
  });
});
