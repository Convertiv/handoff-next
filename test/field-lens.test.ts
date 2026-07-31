import assert from 'node:assert';
import { describe, it } from 'node:test';
import { auditField, deriveLens, describeLens, readPath, summarizeAudits, writePath } from '../src/app/lib/field-lens';

/**
 * Values copied from `handoff_scaffold_args('hero-background')` against the live 8x8 registry, not
 * hand-written approximations. Guessing this shape has now cost three debugging sessions, so the tests
 * are pinned to what the component really holds.
 */
const heroDesktopImage = {
  key: 'Desktop background preview image, 64:35 aspect ratio',
  type: 'img',
  props: {
    alt: '',
    src: '../../images/content/iframe-bg-img.jpeg',
    role: 'presentation',
    width: 2560,
    height: 1400,
    className: 'h-full w-full object-cover',
    'aria-hidden': true,
  },
  _owner: null,
  _store: {},
};

const heroTitleSlot = {
  key: 'title',
  type: 'h1',
  props: {
    className: 'text-4xl leading-tight sm:text-6xl',
    dangerouslySetInnerHTML: { __html: 'Engage on the channels demanded with omnichannel routing' },
  },
  _owner: null,
  _store: {},
};

describe('deriveLens', () => {
  it('locates the src inside a serialized img element, not at the top level', () => {
    const lens = deriveLens(heroDesktopImage);
    assert.equal(lens.kind, 'element');
    assert.deepEqual(lens.kind === 'element' && lens.paths.src, ['props', 'src']);
    assert.deepEqual(lens.kind === 'element' && lens.paths.alt, ['props', 'alt']);
    assert.equal(lens.kind === 'element' && lens.tag, 'img');
  });

  it('recognises a richtext slot by its dangerouslySetInnerHTML, not by its tag', () => {
    const lens = deriveLens(heroTitleSlot);
    assert.equal(lens.kind, 'html');
    assert.deepEqual(lens.kind === 'html' && lens.paths.html, ['props', 'dangerouslySetInnerHTML', '__html']);
  });

  it('reaches an img nested inside a wrapper, recording the path through it', () => {
    const picture = {
      type: 'picture',
      props: { children: [{ type: 'source', props: { srcSet: 'a.webp' } }, heroDesktopImage] },
      _owner: null,
      _store: {},
    };
    const lens = deriveLens(picture);
    assert.deepEqual(lens.kind === 'element' && lens.paths.src, ['props', 'children', 1, 'props', 'src']);
  });

  it('handles plain data, which is what Handlebars components and some React props carry', () => {
    const lens = deriveLens({ src: '/a.jpg', alt: 'A' });
    assert.equal(lens.kind, 'object');
    assert.deepEqual(lens.kind === 'object' && lens.paths.src, ['src']);
  });

  it('describes an array by its first item, since lists are homogeneous', () => {
    const lens = deriveLens([{ url: '/a', text: 'A' }, { url: '/b', text: 'B' }]);
    assert.equal(lens.kind, 'array');
    assert.equal(lens.kind === 'array' && lens.item?.kind, 'object');
  });

  it('says unknown rather than guessing when there is no value', () => {
    assert.equal(deriveLens(null).kind, 'unknown');
    assert.equal(deriveLens(undefined).kind, 'unknown');
    assert.equal(deriveLens([]).kind, 'array');
  });

  it('still offers props.src on an img whose preview omitted it', () => {
    const lens = deriveLens({ type: 'img', props: { alt: '' }, _owner: null, _store: {} });
    assert.deepEqual(lens.kind === 'element' && lens.paths.src, ['props', 'src']);
  });
});

describe('readPath / writePath', () => {
  it('round-trips through the derived lens', () => {
    const lens = deriveLens(heroDesktopImage);
    const path = lens.kind === 'element' ? lens.paths.src! : [];
    const { value, changed } = writePath(heroDesktopImage, path, '/api/handoff/assets/img_x/raw');
    assert.ok(changed);
    assert.equal(readPath(value, path), '/api/handoff/assets/img_x/raw');
  });

  it('preserves everything the write did not target', () => {
    const lens = deriveLens(heroDesktopImage);
    const path = lens.kind === 'element' ? lens.paths.src! : [];
    const { value } = writePath(heroDesktopImage, path, '/new.webp');
    assert.equal((value.props as Record<string, unknown>).width, 2560);
    assert.equal((value.props as Record<string, unknown>).className, 'h-full w-full object-cover');
  });

  it('does not mutate the input', () => {
    const lens = deriveLens(heroDesktopImage);
    const path = lens.kind === 'element' ? lens.paths.src! : [];
    writePath(heroDesktopImage, path, '/new.webp');
    assert.equal(heroDesktopImage.props.src, '../../images/content/iframe-bg-img.jpeg');
  });

  it('refuses to invent structure for a path that does not resolve', () => {
    // A path that does not exist means the lens does not describe this value. Creating the nodes to
    // make the write land is exactly how you get a write that succeeds into something unrendered.
    const { changed } = writePath({ src: '/a.jpg' }, ['props', 'src'], '/b.jpg');
    assert.equal(changed, false);
  });

  it('writes through an array index', () => {
    const { value, changed } = writePath({ items: [{ text: 'a' }, { text: 'b' }] }, ['items', 1, 'text'], 'B');
    assert.ok(changed);
    assert.equal((value.items as { text: string }[])[1]!.text, 'B');
  });
});

describe('auditField', () => {
  const field = (over: Partial<Parameters<typeof auditField>[0]>) =>
    auditField({
      componentId: 'hero-background',
      preview: 'live',
      field: 'desktopImageSlot',
      editorType: 'image',
      declaredShape: '{ src, alt, width?, height? }',
      value: heroDesktopImage,
      hasPreviewValue: true,
      ...over,
    });

  it('catches the bug that shipped: image declared { src, alt }, src at props.src', () => {
    const audit = field({});
    assert.equal(audit.verdict, 'breaks-write');
    assert.match(audit.note!, /props\.src/);
  });

  it('passes an image whose src really is top-level', () => {
    assert.equal(field({ value: { src: '/a.jpg', alt: 'A' } }).verdict, 'ok');
  });

  it('catches an array declaration over a single element — the buttonSlots crash', () => {
    const audit = field({
      field: 'buttonSlots',
      editorType: 'array',
      declaredShape: 'array of button',
      value: { type: 'div', props: { children: [] }, _owner: null, _store: {} },
    });
    assert.equal(audit.verdict, 'breaks-write');
    assert.match(audit.note!, /Declared an array/);
  });

  it('catches an HTML declaration over bare text — the <p> bug', () => {
    const audit = field({
      field: 'overlineSlot',
      editorType: 'slot',
      declaredShape: 'HTML string',
      value: 'Omnichannel routing',
    });
    assert.equal(audit.verdict, 'misleads-author');
  });

  it('accepts a slot whose value really is markup', () => {
    assert.equal(field({ editorType: 'richtext', value: '<p>Real markup</p>' }).verdict, 'ok');
  });

  it('catches plain-text declared over an element value', () => {
    const audit = field({ field: 'titleSlot', editorType: 'text', declaredShape: 'string', value: heroTitleSlot });
    assert.equal(audit.verdict, 'breaks-write');
  });

  it('reports a field no preview exercises as unverified rather than ok', () => {
    // Silence here would be the worst outcome: "ok" on a field nothing has ever rendered is a claim
    // we cannot support.
    assert.equal(field({ hasPreviewValue: false, value: undefined }).verdict, 'no-preview');
  });

  it('does not leak the raw value into the report', () => {
    const audit = field({}) as unknown as Record<string, unknown>;
    assert.ok(!('value' in audit));
    assert.ok(!('hasPreviewValue' in audit));
  });
});

describe('summarizeAudits', () => {
  it('counts by verdict and puts breaks-write first', () => {
    const mk = (verdict: string, field: string) =>
      ({ componentId: 'c', preview: 'p', field, editorType: 'image', declaredShape: '', observed: '', verdict }) as never;
    const report = summarizeAudits([
      mk('ok', 'a'),
      mk('misleads-author', 'b'),
      mk('breaks-write', 'c'),
      mk('no-preview', 'd'),
    ]);
    assert.equal(report.fields, 4);
    assert.equal(report.breaksWrite, 1);
    assert.equal(report.ok, 1);
    assert.equal(report.findings[0]!.verdict, 'breaks-write');
    assert.equal(report.findings.length, 3, 'ok entries are not findings');
  });
});

describe('describeLens', () => {
  it('names the write location, which is the whole point of a lens over a label', () => {
    assert.match(describeLens(deriveLens(heroDesktopImage)), /props\.src/);
  });
});
