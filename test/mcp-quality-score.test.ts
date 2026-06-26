import assert from 'node:assert';
import { describe, it } from 'node:test';
import { scoreResponse, aggregate, buildGroundTruth, type GroundTruth } from '../scripts/mcp-quality/score';

const gt: GroundTruth = buildGroundTruth({
  tokens: {
    colors: [
      { value: '#0077c8', sass: '$color-primary-ssc-blue', reference: 'color-primary-ssc-blue', machineName: 'ssc-blue' },
      { value: '#f5ab0a', sass: '$color-accent-yellow', reference: 'color-accent-yellow', machineName: 'accent-yellow' },
    ],
    spacing: [{ cssVariable: '--spacing-2' }, { cssVariable: '--spacing-4' }],
    borderRadius: [{ cssVariable: '--border-radius-md' }],
  },
  components: [{ id: 'hero_centered' }, { id: 'featured_posts' }],
  icons: [{ name: 'search' }, { id: 'arrow-right' }],
  brandVoice: { brandVoice: { voiceTone: 'authoritative, precise, pragmatic and enterprise-ready' } },
});

describe('buildGroundTruth', () => {
  it('extracts and lowercases colors, css vars, components, icons, brand terms', () => {
    assert.ok(gt.colorValues.includes('#0077c8'));
    assert.ok(gt.colorNames.includes('$color-primary-ssc-blue'));
    assert.ok(gt.cssVariables.includes('--spacing-2'));
    assert.ok(gt.cssVariables.includes('--border-radius-md'));
    assert.ok(gt.componentIds.includes('hero_centered'));
    assert.ok(gt.iconNames.includes('search'));
    assert.ok(gt.brandTerms.includes('authoritative'));
  });
});

describe('scoreResponse', () => {
  it('matches a brandColor by hex value', () => {
    const r = scoreResponse('Use the primary color #0077C8 for the button.', ['brandColor'], gt);
    assert.deepStrictEqual(r.matched, ['brandColor']);
    assert.strictEqual(r.coverage, 1);
  });

  it('matches a spacingVar by css variable', () => {
    const r = scoreResponse('padding: var(--spacing-2);', ['spacingVar'], gt);
    assert.strictEqual(r.coverage, 1);
  });

  it('misses when the response is generic (no real markers)', () => {
    const r = scoreResponse('Use a nice blue color and some padding.', ['brandColor', 'spacingVar'], gt);
    assert.deepStrictEqual(r.missed.sort(), ['brandColor', 'spacingVar']);
    assert.strictEqual(r.coverage, 0);
  });

  it('partial coverage when some kinds match', () => {
    const r = scoreResponse('Use #f5ab0a but I forget the spacing token.', ['brandColor', 'spacingVar'], gt);
    assert.strictEqual(r.coverage, 0.5);
  });

  it('matches a real component id', () => {
    const r = scoreResponse('Build on the hero_centered block.', ['componentId'], gt);
    assert.strictEqual(r.coverage, 1);
  });

  it('matches a brand principle term', () => {
    const r = scoreResponse('The copy should feel authoritative and precise.', ['brandPrinciple'], gt);
    assert.strictEqual(r.coverage, 1);
  });
});

describe('aggregate', () => {
  it('computes pass count and mean coverage', () => {
    const a = aggregate([
      { id: 'a', matched: [], missed: [], coverage: 1 },
      { id: 'b', matched: [], missed: [], coverage: 0.5 },
      { id: 'c', matched: [], missed: [], coverage: 0 },
    ]);
    assert.strictEqual(a.total, 3);
    assert.strictEqual(a.passed, 1);
    assert.ok(Math.abs(a.meanCoverage - 0.5) < 1e-9);
  });
});
