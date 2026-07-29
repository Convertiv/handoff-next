import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildAssetPrompt, planAssetsFromSpec, sizeForAspect } from '../src/app/lib/spec/asset-plan';
import type { AssetRequirement, ComponentSpec } from '../src/app/lib/server/design-spec-types';

const req = (over: Partial<AssetRequirement> = {}): AssetRequirement => ({
  slot: 'backgroundImage',
  kind: 'photo',
  subject: 'a healthcare contact center manager at her desk, calm, natural light',
  aspect: '3:2',
  minWidth: 1200,
  focalPoint: 'center-right',
  ...over,
});

const spec = (assetRequirements?: AssetRequirement[]): ComponentSpec =>
  ({ version: 1, generatedAt: 'x', assetRequirements } as unknown as ComponentSpec);

describe('sizeForAspect', () => {
  it('maps each aspect to the nearest size the API offers', () => {
    assert.equal(sizeForAspect('1:1', 0), '1024x1024');
    assert.equal(sizeForAspect('3:2', 0), '1536x1024');
    assert.equal(sizeForAspect('2:3', 0), '1024x1536');
    assert.equal(sizeForAspect('16:9', 0), '2048x1152');
  });

  it('over-delivers rather than under-delivers when a 3:2 slot needs more than 1536px', () => {
    // Cropping surplus pixels is recoverable; missing resolution is not.
    assert.equal(sizeForAspect('3:2', 1600), '2048x1152');
  });
});

describe('buildAssetPrompt', () => {
  const p = buildAssetPrompt(req());

  it('asks for content, not a mockup — the failure mode is returning a UI screenshot', () => {
    assert.match(p, /NO user-interface elements/);
    assert.match(p, /no buttons, cards, forms, panels, browser chrome, or device frames/);
  });

  it('forbids text, which would make the asset unusable in any other locale or context', () => {
    assert.match(p, /NO text, letters, numbers, words, watermarks, logos or captions/);
  });

  it('forbids collage so the result is one continuous image', () => {
    assert.match(p, /one continuous image/);
  });

  it('carries the subject and the aspect', () => {
    assert.match(p, /healthcare contact center manager/);
    assert.match(p, /3:2/);
  });

  it('uses the focal point when given, and omits the line when not', () => {
    assert.match(p, /center-right/);
    assert.doesNotMatch(buildAssetPrompt(req({ focalPoint: undefined })), /Place the main subject/);
  });

  it('asks for photographic treatment for photos and illustrative for illustrations', () => {
    assert.match(buildAssetPrompt(req({ kind: 'photo' })), /Photographic and natural/);
    assert.match(buildAssetPrompt(req({ kind: 'illustration' })), /Consistent illustration style/);
    assert.doesNotMatch(buildAssetPrompt(req({ kind: 'illustration' })), /Photographic and natural/);
  });
});

describe('planAssetsFromSpec', () => {
  it('returns nothing when the spec declares no imagery', () => {
    assert.deepEqual(planAssetsFromSpec(spec()), []);
    assert.deepEqual(planAssetsFromSpec(spec([])), []);
  });

  it('plans one job per declared asset, at the right size', () => {
    const jobs = planAssetsFromSpec(spec([req(), req({ slot: 'portrait', aspect: '2:3' })]));
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].size, '1536x1024');
    assert.equal(jobs[1].size, '1024x1536');
  });

  it('derives a filename from the slot and the preferred format', () => {
    const [a] = planAssetsFromSpec(spec([req({ slot: 'heroBackground', formats: ['jpeg'] })]));
    assert.equal(a.filename, 'herobackground.jpg');
    const [b] = planAssetsFromSpec(spec([req({ formats: ['webp'] })]));
    assert.equal(b.filename, 'backgroundimage.webp');
    const [c] = planAssetsFromSpec(spec([req({ formats: undefined })]));
    assert.equal(c.filename, 'backgroundimage.png');
  });

  it('tells the composite to place the asset rather than redraw it', () => {
    const [job] = planAssetsFromSpec(spec([req()]));
    assert.match(job.attachmentLabel, /Place it as-is/);
    assert.match(job.attachmentLabel, /Do NOT redraw, restyle, or replace its content/);
    assert.match(job.attachmentLabel, /"backgroundImage" slot/);
  });

  it('drops requirements missing a slot or a subject rather than generating something meaningless', () => {
    const jobs = planAssetsFromSpec(spec([req({ slot: '' }), req({ subject: '' }), req({ slot: 'ok' })]));
    assert.deepEqual(jobs.map((j) => j.slot), ['ok']);
  });

  it('deduplicates slots that slugify to the same name', () => {
    const jobs = planAssetsFromSpec(spec([req({ slot: 'hero image' }), req({ slot: 'hero-image' })]));
    assert.equal(jobs.length, 1);
  });

  it('caps the number of generations so a runaway spec cannot fan out', () => {
    const many = Array.from({ length: 10 }, (_, i) => req({ slot: `img${i}` }));
    assert.equal(planAssetsFromSpec(spec(many)).length, 4);
    assert.equal(planAssetsFromSpec(spec(many), { max: 2 }).length, 2);
  });

  it('defaults aspect and kind when a spec omits them', () => {
    const [job] = planAssetsFromSpec(spec([{ slot: 's', subject: 'a desk' } as AssetRequirement]));
    assert.equal(job.size, '1536x1024');
    assert.equal(job.kind, 'photo');
  });
});
