import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildGenerationPromptFromSpec } from '../src/app/lib/spec/generation-prompt';
import { specFidelity } from '../src/app/lib/spec/fidelity';
import type { ComponentSpec } from '../src/app/lib/server/design-spec-types';

function spec(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    version: 1,
    generatedAt: '2026-07-29T00:00:00.000Z',
    overview: { name: 'WebinarHero', description: 'A hero', type: 'template', designSystemGroup: 'Marketing', summary: 'Two-column hero with a form.' },
    variants: [{ key: 'default', name: 'Default', description: 'Standard layout', isDefault: true }],
    props: [
      { name: 'headline', type: 'string', required: true, description: 'Main headline' },
      { name: 'backgroundImage', type: 'string', required: false, description: 'URL of the hero photograph' },
    ],
    behavior: { interactions: [], transitions: [], edgeCases: [] },
    accessibility: { ariaRole: 'region', requiredAriaAttributes: [], keyboardNav: [], screenReaderNotes: '', wcagTarget: 'AA' },
    content: {
      textInventory: [
        { text: 'Build your AI agent', role: 'heading', location: 'left panel', editable: true },
        { text: 'Save your seat', role: 'button', location: 'left panel', editable: true },
        { text: 'Register for the webinar', role: 'heading', location: 'form card', editable: true },
      ],
      copyFromPrompt: [],
      rules: [],
    },
    implementation: { existingComponentMatches: [], dependencies: [], cssNotes: 'Two-column grid, form card right.', developerHints: [] },
    tokens: {
      colors: [{ observed: '#04888a', usage: 'primary button', token: 'color-secondary-deep-teal', reference: 'x', matchLevel: 'exact' }],
      typography: [{ observed: 'PP Telegraf 700 48/55', usage: 'headline', token: 'typography-heading-2-bold', reference: 'x', matchLevel: 'exact' }],
      spacing: [{ observed: '32px', usage: 'card padding', token: 'var(--spacing-8)', reference: 'x', matchLevel: 'exact' }],
      radii: [],
      coverage: 1,
      notes: '',
    },
    ...overrides,
  } as ComponentSpec;
}

describe('buildGenerationPromptFromSpec', () => {
  const p = buildGenerationPromptFromSpec(spec());

  it('names the component and its type', () => {
    assert.match(p, /"WebinarHero"/);
    assert.match(p, /template/);
  });

  it('carries every copy string verbatim, grouped by location', () => {
    assert.match(p, /Build your AI agent/);
    assert.match(p, /Save your seat/);
    assert.match(p, /Register for the webinar/);
    assert.match(p, /\*\*left panel\*\*/);
    assert.match(p, /\*\*form card\*\*/);
  });

  it('emits observed values, not CSS variables, since an image model cannot resolve tokens', () => {
    assert.match(p, /#04888a/);
    assert.match(p, /32px/);
    assert.match(p, /PP Telegraf 700 48\/55/);
  });

  it('still labels which token each value came from', () => {
    assert.match(p, /color-secondary-deep-teal/);
  });

  it('carries layout structure', () => {
    assert.match(p, /Two-column grid, form card right\./);
  });

  it('identifies required imagery from image-ish props', () => {
    assert.match(p, /backgroundImage/);
    assert.match(p, /hero photograph/);
  });

  it('forbids invented content, which is the failure mode the experiment is measuring', () => {
    assert.match(p, /Do not invent additional text, statistics, dates or labels/);
  });

  it('never references the original image — that would defeat the experiment', () => {
    assert.doesNotMatch(p, /data:image|artifact-asset|imageUrl/);
  });

  it('includes art direction only when supplied', () => {
    assert.doesNotMatch(p, /## Art direction/);
    assert.match(buildGenerationPromptFromSpec(spec(), { artDirection: 'Calm, lots of air' }), /## Art direction\nCalm, lots of air/);
  });
});

describe('specFidelity', () => {
  it('scores a perfect round trip as 1', () => {
    const f = specFidelity(spec(), spec());
    assert.equal(f.score, 1);
    assert.deepEqual(f.lostCopy, []);
    assert.deepEqual(f.inventedCopy, []);
  });

  it('reports copy that did not survive', () => {
    const after = spec({
      content: {
        textInventory: [
          { text: 'Build your AI agent', role: 'heading', location: 'left panel', editable: true },
          { text: 'Save your seat', role: 'button', location: 'left panel', editable: true },
        ],
        copyFromPrompt: [],
        rules: [],
      },
    });
    const f = specFidelity(spec(), after);
    assert.deepEqual(f.lostCopy, ['Register for the webinar']);
    const content = f.dimensions.find((d) => d.dimension === 'content');
    assert.ok(content && content.score !== null && Math.abs(content.score - 2 / 3) < 1e-9);
  });

  it('reports invented copy separately from loss', () => {
    const after = spec({
      content: {
        textInventory: [
          ...spec().content.textInventory,
          { text: 'Thursday, May 29 at 11:00 AM PT', role: 'body', location: 'form card', editable: true },
        ],
        copyFromPrompt: [],
        rules: [],
      },
    });
    const f = specFidelity(spec(), after);
    assert.deepEqual(f.lostCopy, []);
    assert.deepEqual(f.inventedCopy, ['Thursday, May 29 at 11:00 AM PT']);
    // Invention must not be punished as loss — recall is unaffected.
    const content = f.dimensions.find((d) => d.dimension === 'content');
    assert.equal(content?.score, 1);
  });

  it('ignores whitespace and case when matching copy', () => {
    const after = spec({
      content: {
        textInventory: spec().content.textInventory.map((t) => ({ ...t, text: `  ${t.text.toUpperCase()}  ` })),
        copyFromPrompt: [],
        rules: [],
      },
    });
    assert.equal(specFidelity(spec(), after).score, 1);
  });

  it('scores tokens on the token landed on, not the observed pixel value', () => {
    const after = spec({
      tokens: {
        ...spec().tokens!,
        // Same tokens, slightly different observed values — a re-render, not a design change.
        spacing: [{ observed: '31px', usage: 'card padding', token: 'var(--spacing-8)', reference: 'x', matchLevel: 'close' }],
      },
    });
    const tokens = specFidelity(spec(), after).dimensions.find((d) => d.dimension === 'tokens');
    assert.equal(tokens?.score, 1);
  });

  it('penalises landing on different tokens', () => {
    const after = spec({
      tokens: { ...spec().tokens!, colors: [{ observed: '#ff0000', usage: 'primary button', token: 'color-danger', reference: 'x', matchLevel: 'exact' }] },
    });
    const tokens = specFidelity(spec(), after).dimensions.find((d) => d.dimension === 'tokens');
    assert.ok(tokens && tokens.score !== null && tokens.score < 1);
  });

  it('does not score a dimension that has nothing to compare', () => {
    const bare = spec({ tokens: undefined });
    const tokens = specFidelity(bare, bare).dimensions.find((d) => d.dimension === 'tokens');
    assert.equal(tokens?.score, null);
    // A null dimension must not drag the weighted mean down.
    assert.equal(specFidelity(bare, bare).score, 1);
  });

  it('weights content most heavily, since copy survival is the objective signal', () => {
    const weights = Object.fromEntries(specFidelity(spec(), spec()).dimensions.map((d) => [d.dimension, d.weight]));
    assert.ok(weights.content > weights.tokens);
    assert.ok(weights.tokens > weights.structure);
    assert.ok(weights.structure > weights.props);
  });
});
