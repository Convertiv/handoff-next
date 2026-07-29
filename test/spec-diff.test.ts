import assert from 'node:assert';
import { describe, it } from 'node:test';
import { diffSpecs } from '../src/app/lib/spec/diff';
import type { ComponentSpec } from '../src/app/lib/server/design-spec-types';

/** Minimal but structurally valid spec; helpers below override slices of it. */
function baseSpec(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    version: 1,
    generatedAt: '2026-07-29T00:00:00.000Z',
    overview: { name: 'Hero', description: 'A hero', type: 'template', designSystemGroup: 'Marketing', summary: 'Summary' },
    variants: [{ key: 'default', name: 'Default', description: 'Standard', isDefault: true }],
    props: [{ name: 'headline', type: 'string', required: true, description: 'Main headline' }],
    behavior: { interactions: [], transitions: [], edgeCases: [] },
    accessibility: { ariaRole: 'form', requiredAriaAttributes: [], keyboardNav: [], screenReaderNotes: '', wcagTarget: 'AA' },
    content: { textInventory: [{ text: 'Build your AI agent', role: 'heading', location: 'left column', editable: true }], copyFromPrompt: [], rules: [] },
    implementation: { existingComponentMatches: [], dependencies: [], cssNotes: '', developerHints: [] },
    ...overrides,
  } as ComponentSpec;
}

const sectionOf = (d: ReturnType<typeof diffSpecs>, name: string) => d.sections.find((s) => s.section === name);

describe('diffSpecs', () => {
  it('reports the first version as initial, not as a pile of additions', () => {
    const d = diffSpecs(null, baseSpec());
    assert.deepEqual(d.summary, ['Initial specification.']);
  });

  it('treats an identical spec as unchanged', () => {
    const d = diffSpecs(baseSpec(), baseSpec());
    assert.equal(d.unchanged, true);
    assert.equal(d.sections.length, 0);
  });

  it('ignores generatedAt, which changes on every run', () => {
    const d = diffSpecs(baseSpec(), baseSpec({ generatedAt: '2030-01-01T00:00:00.000Z' }));
    assert.equal(d.unchanged, true);
  });

  it('ignores reordering — entries are keyed by identity, not array position', () => {
    const props = [
      { name: 'headline', type: 'string', required: true, description: 'Main headline' },
      { name: 'cta', type: 'string', required: false, description: 'Button text' },
    ];
    const before = baseSpec({ props });
    const after = baseSpec({ props: [props[1], props[0]] });
    assert.equal(diffSpecs(before, after).unchanged, true);
  });

  it('detects a changed prop and records the before/after', () => {
    const after = baseSpec({ props: [{ name: 'headline', type: 'string', required: false, description: 'Main headline' }] });
    const props = sectionOf(diffSpecs(baseSpec(), after), 'props');
    assert.ok(props);
    assert.equal(props.entries.length, 1);
    assert.equal(props.entries[0].kind, 'changed');
    assert.equal(props.entries[0].key, 'headline');
    assert.deepEqual(props.entries[0].fields, [{ field: 'required', before: 'true', after: 'false' }]);
  });

  it('detects added and removed props', () => {
    const after = baseSpec({ props: [{ name: 'cta', type: 'string', required: true, description: 'Button' }] });
    const props = sectionOf(diffSpecs(baseSpec(), after), 'props');
    assert.ok(props);
    const kinds = props.entries.map((e) => `${e.kind}:${e.key}`).sort();
    assert.deepEqual(kinds, ['added:cta', 'removed:headline']);
  });

  it('normalizes whitespace so a reflowed string is not a change', () => {
    const after = baseSpec({
      content: {
        textInventory: [{ text: 'Build   your\nAI agent', role: 'heading', location: 'left column', editable: true }],
        copyFromPrompt: [],
        rules: [],
      },
    });
    assert.equal(diffSpecs(baseSpec(), after).unchanged, true);
  });

  it('reports a copy rewrite as removed + added', () => {
    const after = baseSpec({
      content: {
        textInventory: [{ text: 'Ship your AI agent', role: 'heading', location: 'left column', editable: true }],
        copyFromPrompt: [],
        rules: [],
      },
    });
    const content = sectionOf(diffSpecs(baseSpec(), after), 'content');
    assert.ok(content);
    assert.deepEqual(content.entries.map((e) => e.kind).sort(), ['added', 'removed']);
  });

  it('keys tokens on observed value AND usage, so the same colour in two roles stays distinct', () => {
    const before = baseSpec({
      tokens: {
        colors: [
          { observed: '#04888a', usage: 'primary button', token: 'color-secondary-deep-teal', reference: 'x', matchLevel: 'exact' },
          { observed: '#04888a', usage: 'icons', token: 'color-secondary-deep-teal', reference: 'x', matchLevel: 'exact' },
        ],
        typography: [],
        spacing: [],
        radii: [],
        coverage: 1,
        notes: '',
      },
    });
    const after = baseSpec({
      tokens: {
        colors: [
          { observed: '#04888a', usage: 'primary button', token: 'color-secondary-deep-teal', reference: 'x', matchLevel: 'exact' },
          { observed: '#04888a', usage: 'icons', token: null, reference: null, matchLevel: 'none', note: 'off-system' },
        ],
        typography: [],
        spacing: [],
        radii: [],
        coverage: 0.5,
        notes: '',
      },
    });
    const tokens = sectionOf(diffSpecs(before, after), 'tokens');
    assert.ok(tokens);
    // Only the "icons" usage changed, even though both rows share the same observed value.
    assert.equal(tokens.entries.length, 1);
    assert.equal(tokens.entries[0].key, 'colors:#04888a|icons');
    assert.ok(tokens.fields.some((f) => f.field === 'coverage' && f.before === '1' && f.after === '0.5'));
  });

  it('detects a section appearing for the first time', () => {
    const after = baseSpec({
      reuse: { candidates: [{ componentId: 'hero-form', title: 'Hero Form', role: 'form', confidence: 0.8, note: 'fits' }], patterns: [], compositionScore: 0.9, recommendation: 'Compose' },
    });
    const reuse = sectionOf(diffSpecs(baseSpec(), after), 'reuse');
    assert.ok(reuse);
    assert.equal(reuse.presenceChanged, true);
    assert.equal(reuse.entries[0].kind, 'added');
    assert.equal(reuse.entries[0].key, 'component:hero-form');
  });

  it('tracks a voice verdict flipping on the same copy', () => {
    const mk = (verdict: 'pass' | 'warn') =>
      baseSpec({
        voice: { findings: [{ text: 'Register for the webinar', role: 'heading', verdict, rule: 'length', detail: 'd' }], bannedPhrasesFound: [], score: 1, summary: '' },
      });
    const voice = sectionOf(diffSpecs(mk('pass'), mk('warn')), 'voice');
    assert.ok(voice);
    assert.equal(voice.entries.length, 1);
    assert.equal(voice.entries[0].kind, 'changed');
    assert.ok(voice.entries[0].fields?.some((f) => f.field === 'verdict' && f.before === 'pass' && f.after === 'warn'));
  });

  it('produces per-section changelog lines', () => {
    const after = baseSpec({
      overview: { name: 'WebinarHero', description: 'A hero', type: 'template', designSystemGroup: 'Marketing', summary: 'Summary' },
      props: [
        { name: 'headline', type: 'string', required: true, description: 'Main headline' },
        { name: 'cta', type: 'string', required: false, description: 'Button' },
      ],
    });
    const d = diffSpecs(baseSpec(), after);
    assert.ok(d.summary.some((s) => s.startsWith('overview:') && s.includes('name')));
    assert.ok(d.summary.some((s) => s.startsWith('props:') && s.includes('1 added')));
  });
});
