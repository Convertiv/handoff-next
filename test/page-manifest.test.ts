import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildPageManifest, manifestToMarkdown } from '../src/app/lib/page-manifest';
import { cmsMigrationPrompt, toCmsTarget } from '../src/app/lib/cms-migration-prompt';

/**
 * The content manifest (reflow R.6) — the payload a CMS migration reasons from, and the thing a content
 * reviewer reads.
 *
 * What matters here is **fidelity**: every string that ships appears, in order, unedited. A manifest that
 * quietly drops or rewrites a value would send someone into a migration with a false inventory.
 */

const blocks = [
  {
    id: 'hero',
    args: {
      title: 'Engage on every channel',
      body: 'Voice, chat and email in one place.',
      image: { src: 'https://cdn.example.com/hero.jpg', alt: 'A busy contact centre' },
      // Config, not content: the collectors already know to skip these.
      theme: 'dark',
      columns: 3,
    },
  },
  { id: 'cta', args: { heading: 'Talk to us', button: { label: 'Book a demo', href: 'https://example.com/demo' } } },
  // A block with nothing in it — a spacer. It must still appear, or the page's shape is misreported.
  { id: 'spacer', args: { size: 'lg' } },
];

const manifest = () =>
  buildPageManifest({
    pageId: 'page_1',
    title: 'Contact centre',
    description: 'The campaign landing page.',
    blocks,
    titles: { hero: 'Hero', cta: 'Call to action' },
  });

describe('buildPageManifest', () => {
  it('keeps every block, in page order, including the empty one', () => {
    const m = manifest();
    assert.deepEqual(
      m.blocks.map((b) => [b.position, b.componentId]),
      [
        [1, 'hero'],
        [2, 'cta'],
        [3, 'spacer'],
      ]
    );
  });

  it('reports copy verbatim', () => {
    // Not trimmed, not normalised, not re-cased: a migration writes these exact strings.
    const hero = manifest().blocks[0];
    const values = hero.fields.map((f) => f.value);
    assert.ok(values.includes('Engage on every channel'), JSON.stringify(values));
    assert.ok(values.includes('Voice, chat and email in one place.'), JSON.stringify(values));
  });

  it('addresses each field by path, so a consumer can point at what it is reading', () => {
    const paths = manifest().blocks[1].fields.map((f) => f.path);
    assert.ok(paths.includes('heading'), JSON.stringify(paths));
    assert.ok(paths.includes('button.label'), JSON.stringify(paths));
  });

  it('names a block by its title when the caller has one, and by its id otherwise', () => {
    const m = manifest();
    assert.equal(m.blocks[0].title, 'Hero');
    // Never a guess: an unknown component is reported as its id.
    assert.equal(m.blocks[2].title, 'spacer');
  });

  it('carries images without claiming an alt it was never given', () => {
    // `collectImageSrcs` reports no alt — alt text is a string, so it arrives as a *field*. Inventing an
    // `alt: null` here would have printed "no alt text" for every image on every page.
    const hero = manifest().blocks[0];
    assert.equal(hero.images.length, 1);
    assert.equal(hero.images[0].src, 'https://cdn.example.com/hero.jpg');
    assert.ok(!('alt' in hero.images[0]));
    assert.ok(
      hero.fields.some((f) => f.value === 'A busy contact centre'),
      'alt text should appear among the fields'
    );
  });

  it('totals what is there', () => {
    const m = manifest();
    assert.equal(m.totals.blocks, 3);
    assert.equal(m.totals.images, 1);
    assert.equal(
      m.totals.characters,
      m.blocks.reduce((n, b) => n + b.fields.reduce((s, f) => s + f.value.length, 0), 0)
    );
  });

  it('handles a page with no blocks at all', () => {
    const empty = buildPageManifest({ pageId: 'p', title: '', blocks: [] });
    assert.deepEqual(empty.totals, { blocks: 0, fields: 0, images: 0, characters: 0 });
  });
});

describe('manifestToMarkdown', () => {
  it('renders every value, unedited', () => {
    const md = manifestToMarkdown(manifest());
    assert.match(md, /# Contact centre/);
    assert.match(md, /## 1\. Hero/);
    assert.ok(md.includes('Voice, chat and email in one place.'));
    assert.ok(md.includes('https://cdn.example.com/hero.jpg'));
  });

  it('says so when a block carries no content, rather than rendering a bare heading', () => {
    assert.match(manifestToMarkdown(manifest()), /configuration only/);
  });

  it('counts in English', () => {
    // The summary line is the first thing a reviewer reads; "1 images" makes them trust the rest of it less.
    const md = manifestToMarkdown(manifest());
    assert.ok(md.includes('1 image ·'), md.split('\n')[2]);
    assert.ok(!md.includes('1 images'), md.split('\n')[2]);
    assert.ok(!/\b1 chars\b/.test(md), 'singular char count');
  });
});

describe('cmsMigrationPrompt', () => {
  it('carries the whole manifest, so the agent needs nothing else', () => {
    const prompt = cmsMigrationPrompt(manifest(), 'hubspot');
    assert.ok(prompt.includes('Engage on every channel'));
    assert.ok(prompt.includes('https://cdn.example.com/hero.jpg'));
  });

  it('tells the agent what the target is made of', () => {
    assert.match(cmsMigrationPrompt(manifest(), 'hubspot'), /modules/);
    assert.match(cmsMigrationPrompt(manifest(), 'sanity'), /document type/i);
    // No target still produces a usable prompt — inspect first, then map.
    assert.match(cmsMigrationPrompt(manifest()), /Inspect the CMS/);
  });

  it('states the prohibitions that make an agent safe to point at a CMS', () => {
    const prompt = cmsMigrationPrompt(manifest(), 'sanity');
    for (const rule of [/Do not invent content/, /Do not drop content silently/, /Do not reformat copy/, /Ask before anything destructive/]) {
      assert.match(prompt, rule);
    }
  });

  it('asks for the mapping before the writing', () => {
    assert.match(cmsMigrationPrompt(manifest()), /Propose the mapping before you create anything/);
  });
});

describe('toCmsTarget', () => {
  it('accepts the two it knows and shrugs at everything else', () => {
    assert.equal(toCmsTarget('HubSpot'), 'hubspot');
    assert.equal(toCmsTarget(' sanity '), 'sanity');
    for (const junk of ['wordpress', '', null, 42, undefined]) assert.equal(toCmsTarget(junk), 'unknown');
  });
});
