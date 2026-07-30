import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildGenerationPromptFromSpec } from '../src/app/lib/spec/generation-prompt';
import type { ComponentSpec } from '../src/app/lib/server/design-spec-types';

/**
 * The `tokens` section measures a *render*. Feeding its observations back as instructions made
 * re-rendering unable to correct anything — the drift became the requirement.
 */
function specWithTokens(colors: unknown[]): ComponentSpec {
  return {
    version: 1,
    generatedAt: '2026-07-30T00:00:00.000Z',
    overview: { name: 'Hero', description: 'd', type: 'organism', designSystemGroup: 'Marketing', summary: 's' },
    variants: [],
    props: [],
    behavior: { interactions: [], transitions: [], edgeCases: [] },
    accessibility: { ariaRole: 'region', requiredAriaAttributes: [], keyboardNav: [], screenReaderNotes: '', wcagTarget: 'AA' },
    content: { textInventory: [], copyFromPrompt: [], rules: [] },
    implementation: { existingComponentMatches: [], dependencies: [], cssNotes: '', developerHints: [] },
    tokens: { colors, typography: [], spacing: [], radii: [], coverage: 0.7, notes: '' },
  } as unknown as ComponentSpec;
}

describe('buildGenerationPromptFromSpec — token values', () => {
  it('never restates an off-system observation as an instruction', () => {
    // The exact 8x8 case: a blue the token set does not contain, recorded by the conformance pass.
    const prompt = buildGenerationPromptFromSpec(
      specWithTokens([
        { observed: '#0065d1', usage: 'primary button background', token: null, reference: null, matchLevel: 'none' },
      ])
    );
    assert.doesNotMatch(prompt, /#0065d1/, 'the drifted colour must not become a requirement');
  });

  it('emits the design system value, not the rendered approximation', () => {
    const prompt = buildGenerationPromptFromSpec(
      specWithTokens([
        {
          observed: '#04888b',
          usage: 'primary button background',
          token: 'color-secondary-deep-teal',
          reference: '#04888a → color-secondary-deep-teal',
          matchLevel: 'close',
        },
      ])
    );
    assert.match(prompt, /#04888a/, 'must use the token value');
    assert.doesNotMatch(prompt, /#04888b/, 'must not use the observed near-miss');
    assert.match(prompt, /color-secondary-deep-teal/);
  });

  it('keeps exact matches, which are the on-system values worth restating', () => {
    const prompt = buildGenerationPromptFromSpec(
      specWithTokens([
        {
          observed: '#ebeae1',
          usage: 'background',
          token: 'color-primary-off-white',
          reference: '#ebeae1 → color-primary-off-white',
          matchLevel: 'exact',
        },
      ])
    );
    assert.match(prompt, /#ebeae1/);
  });

  it('falls back to observed when the reference is not in "<value> → <token>" form', () => {
    // Some rows carry a reference that is not a value at all. Treating it as one substituted garbage
    // for a real colour.
    const prompt = buildGenerationPromptFromSpec(
      specWithTokens([
        { observed: '#04888a', usage: 'primary button', token: 'color-secondary-deep-teal', reference: 'x', matchLevel: 'exact' },
      ])
    );
    assert.match(prompt, /#04888a/);
    assert.doesNotMatch(prompt, /- colour x —/);
  });

  it('drops a row with a token but no usable value rather than emitting a blank instruction', () => {
    const prompt = buildGenerationPromptFromSpec(
      specWithTokens([{ observed: '', usage: 'background', token: 'some-token', reference: '', matchLevel: 'exact' }])
    );
    assert.doesNotMatch(prompt, /- colour\s+—/);
  });
});
