import assert from 'node:assert';
import { describe, it } from 'node:test';
import Handlebars from 'handlebars';
import {
  fieldIdToArgsPath,
  parseFieldMarks,
  registerFieldMarkHelper,
  textEditableFieldPaths,
} from '../src/app/lib/field-marks';

/**
 * The playground `field` helper's marks — roadmap F.1, the foundation inline editing stands on for Handlebars.
 *
 * Exercises the **real** helper and the **real** parser from `lib/field-marks.ts`, not a copy: the format has three
 * participants (the helper that writes it, the editor that reads it, these tests), and a second definition is how
 * a load-bearing wire format drifts into silence.
 */
function render(template: string, context: unknown): string {
  const hb = Handlebars.create();
  registerFieldMarkHelper(hb);
  return hb.compile(template)(context);
}

describe('field marks', () => {
  it('brackets the rendered value with a start and end comment', () => {
    const out = render("<h2>{{#field 'title'}}{{properties.title}}{{/field}}</h2>", {
      properties: { title: 'Reliable Campus Communications' },
    });
    assert.equal(out, '<h2><!--hf:title-->Reliable Campus Communications<!--/hf:title--></h2>');
  });

  /**
   * The case that ruled out a `<span>` wrapper: 26 of SS&C's 292 field blocks wrap block-level content, and a
   * span around an `<li>` is invalid nesting the browser reparents.
   */
  it('marks block-level content without wrapping it in an element', () => {
    const out = render(
      '<ul>{{#field "submenu"}}{{#each properties.submenu}}<li>{{this.label}}</li>{{/each}}{{/field}}</ul>',
      { properties: { submenu: [{ label: 'Privacy' }, { label: 'Terms' }] } }
    );
    assert.equal(out, '<ul><!--hf:submenu--><li>Privacy</li><li>Terms</li><!--/hf:submenu--></ul>');
    // No element was introduced, so nothing can be reparented and no selector changes meaning.
    assert.ok(!out.includes('<span'));
  });

  /** The ambiguity that made annotation-only mapping unworkable: one rule, many rows. */
  it('disambiguates array rows by index', () => {
    const out = render(
      '{{#each properties.items}}<p>{{#field "items.paragraph"}}{{this.paragraph}}{{/field}}</p>{{/each}}',
      { properties: { items: [{ paragraph: 'First' }, { paragraph: 'Second' }] } }
    );
    assert.match(out, /<!--hf:items\.paragraph:0-->First<!--\/hf:items\.paragraph:0-->/);
    assert.match(out, /<!--hf:items\.paragraph:1-->Second<!--\/hf:items\.paragraph:1-->/);
  });

  it('omits the index outside an each frame', () => {
    const out = render("{{#field 'title'}}x{{/field}}", {});
    assert.equal(out, '<!--hf:title-->x<!--/hf:title-->');
  });

  it('handles a dotted nested path as its own name', () => {
    const out = render(`{{#field "author.linked_in"}}/in/someone{{/field}}`, {});
    assert.equal(out, '<!--hf:author.linked_in-->/in/someone<!--/hf:author.linked_in-->');
  });

  /** Raw HTML through a triple-stache is the richtext case; the marks must not disturb it. */
  it('leaves raw HTML content intact', () => {
    const out = render('<div>{{#field "body"}}{{{properties.body}}}{{/field}}</div>', {
      properties: { body: '<p>One unified system.</p>' },
    });
    assert.equal(out, '<div><!--hf:body--><p>One unified system.</p><!--/hf:body--></div>');
  });

  it('renders the body unmarked when the field name is missing', () => {
    assert.equal(render('{{#field ""}}kept{{/field}}', {}), 'kept');
  });

  /**
   * An empty value still produces a locatable, zero-width range — which is how the editor offers to fill a slot
   * that renders nothing today.
   */
  it('marks an empty value as an empty range', () => {
    const out = render("{{#field 'title'}}{{properties.missing}}{{/field}}", { properties: {} });
    assert.equal(out, '<!--hf:title--><!--/hf:title-->');
  });
});

describe('field marks — parsing them back', () => {
  it('round-trips every field in a realistic template', () => {
    const out = render(
      `<article>
        <h1>{{#field 'title'}}{{properties.title}}{{/field}}</h1>
        <p>{{#field 'paragraph'}}{{properties.paragraph}}{{/field}}</p>
        {{#each properties.authors}}<span>{{#field 'authors.name'}}{{this.name}}{{/field}}</span>{{/each}}
      </article>`,
      { properties: { title: 'A headline', paragraph: 'Some copy.', authors: [{ name: 'Ada' }, { name: 'Grace' }] } }
    );
    assert.deepEqual(
      parseFieldMarks(out).map((m) => [m.field, m.index, m.body]),
      [
        ['title', null, 'A headline'],
        ['paragraph', null, 'Some copy.'],
        ['authors.name', 0, 'Ada'],
        ['authors.name', 1, 'Grace'],
      ]
    );
  });

  /** The parser splits the row index off the path, so a caller addresses `items.paragraph` row 2 directly. */
  it('separates the field path from the row index', () => {
    const out = render('{{#each properties.items}}{{#field "items.paragraph"}}{{this.p}}{{/field}}{{/each}}', {
      properties: { items: [{ p: 'a' }, { p: 'b' }] },
    });
    const marks = parseFieldMarks(out);
    assert.deepEqual(marks[1], { id: 'items.paragraph:1', field: 'items.paragraph', index: 1, body: 'b' });
  });

  /** A nested field must not be mistaken for the end of the one enclosing it. */
  it('keeps nested marks distinct', () => {
    const out = render('{{#field "outer"}}<p>{{#field "inner"}}x{{/field}}</p>{{/field}}', {});
    const fields = parseFieldMarks(out).map((m) => m.field);
    assert.ok(fields.includes('inner'));
  });

  it('finds nothing in unmarked output', () => {
    assert.deepEqual(parseFieldMarks('<h2>Plain</h2>'), []);
  });
});

/**
 * Mark id → args path, the join between a mark in the canvas and the value in the block's data.
 *
 * `handleInputChange` takes exactly this shape, so getting it wrong means an edit writes to a path nothing
 * renders — the silent-success failure mode this whole phase exists to stop.
 */
describe('fieldIdToArgsPath', () => {
  it('maps a plain field', () => {
    assert.deepEqual(fieldIdToArgsPath('title'), ['title']);
  });

  it('maps a nested object field', () => {
    assert.deepEqual(fieldIdToArgsPath('author.linked_in'), ['author', 'linked_in']);
  });

  /** The index belongs to the array, which is the first segment — `{{#field "items.paragraph"}}` inside each. */
  it('places a row index after the array segment', () => {
    assert.deepEqual(fieldIdToArgsPath('items.paragraph:1'), ['items', 1, 'paragraph']);
    assert.deepEqual(fieldIdToArgsPath('authors.name:0'), ['authors', 0, 'name']);
  });

  it('addresses the row itself when the field is the array', () => {
    assert.deepEqual(fieldIdToArgsPath('items:2'), ['items', 2]);
  });

  it('keeps deeper leaves after the index', () => {
    assert.deepEqual(fieldIdToArgsPath('cards.cta.text:3'), ['cards', 3, 'cta', 'text']);
  });

  it('tolerates junk', () => {
    assert.deepEqual(fieldIdToArgsPath(''), []);
    assert.deepEqual(fieldIdToArgsPath('a..b'), ['a', 'b']);
  });
});

/**
 * Which marks a text overlay may edit.
 *
 * Both exclusions came from driving the F.2 overlay over real template output: a field wrapping a repeater read
 * back as its rows concatenated (`"PrivacyTerms"`), and richtext read back with its markup stripped. Committing
 * either would have written the wrong shape without any error.
 */
describe('textEditableFieldPaths', () => {
  it('allows plain text and string fields', () => {
    assert.deepEqual(
      textEditableFieldPaths({ titleSlot: { type: 'text' }, eyebrow: { type: 'string' } }).sort(),
      ['eyebrow', 'titleSlot']
    );
  });

  /** The corruption case: a string committed over an array of objects. */
  it('excludes an array — the repeater case', () => {
    assert.deepEqual(textEditableFieldPaths({ menu: { type: 'array', items: { properties: {} } } }), []);
  });

  /** The lossy case: `<strong>One</strong> unified.` reads back as `One unified.` */
  it('excludes richtext, which the rail still owns', () => {
    assert.deepEqual(textEditableFieldPaths({ bodySlot: { type: 'richtext' } }), []);
  });

  it('excludes images, config and slots', () => {
    assert.deepEqual(
      textEditableFieldPaths({
        imageSlot: { type: 'image' },
        theme: { type: 'enum' },
        useCarousel: { type: 'boolean' },
        bodySlot: { type: 'React.ReactNode' },
      }),
      []
    );
  });

  it('finds text inside an object and inside array items', () => {
    const paths = textEditableFieldPaths({
      author: { type: 'object', properties: { name: { type: 'text' }, link: { type: 'link' } } },
      items: { type: 'array', items: { properties: { paragraph: { type: 'text' }, open: { type: 'boolean' } } } },
    }).sort();
    // Array item paths keep the parent's path, matching how a template inside `{{#each}}` names them.
    assert.deepEqual(paths, ['author.name', 'items.paragraph']);
  });

  /** An authored `editorType` states intent and wins, as everywhere else. */
  it('respects editorType over the raw type', () => {
    assert.deepEqual(textEditableFieldPaths({ slotty: { type: 'React.ReactNode', editorType: 'text' } }), ['slotty']);
    assert.deepEqual(textEditableFieldPaths({ locked: { type: 'text', editorType: 'select' } }), []);
  });

  it('tolerates nonsense', () => {
    assert.deepEqual(textEditableFieldPaths(undefined), []);
    assert.deepEqual(textEditableFieldPaths('nope'), []);
  });
});
