import assert from 'node:assert';
import { describe, it } from 'node:test';
import { byteLength, capPayload, describeDataUri, isDataUri, stripInlineData } from '../src/app/lib/mcp/payload';

const png = (kb: number) => `data:image/png;base64,${'A'.repeat(kb * 1024)}`;

describe('isDataUri', () => {
  it('recognizes base64 and plain data URIs', () => {
    assert.equal(isDataUri('data:image/png;base64,AAAA'), true);
    assert.equal(isDataUri('data:image/svg+xml,%3Csvg'), true);
  });

  it('leaves real URLs and ordinary strings alone', () => {
    for (const s of ['https://example.com/a.png', '/api/handoff/artifact-asset?p=x', 'data-driven design', '']) {
      assert.equal(isDataUri(s), false, s);
    }
  });
});

describe('describeDataUri', () => {
  it('keeps the mime type and size, which is the part a model can act on', () => {
    const d = describeDataUri(png(100));
    assert.match(d, /image\/png/);
    assert.match(d, /\d+KB omitted/);
  });

  it('is dramatically smaller than what it replaces', () => {
    assert.ok(byteLength(describeDataUri(png(500))) < 200);
  });
});

describe('stripInlineData', () => {
  it('strips nested inline images and reports what it removed', () => {
    const input = {
      id: 'a1',
      imageUrl: png(50),
      assets: [{ label: 'hero', imageUrl: png(20) }, { label: 'icon', imageUrl: '/api/handoff/artifact-asset?p=x' }],
    };
    const { value, stripped, bytesSaved } = stripInlineData(input);
    const out = value as typeof input;
    assert.equal(stripped, 2);
    assert.ok(bytesSaved > 60 * 1024);
    assert.match(out.imageUrl, /omitted/);
    assert.match(out.assets[0].imageUrl, /omitted/);
    // A usable reference must survive — that's how the model gets the real bytes.
    assert.equal(out.assets[1].imageUrl, '/api/handoff/artifact-asset?p=x');
  });

  it('never mutates the input', () => {
    const input = { imageUrl: png(10) };
    stripInlineData(input);
    assert.ok(input.imageUrl.startsWith('data:image/png'));
  });

  it('preserves non-plain objects such as Date rather than flattening them', () => {
    const when = new Date('2026-07-29T00:00:00.000Z');
    const { value } = stripInlineData({ createdAt: when });
    assert.equal((value as { createdAt: Date }).createdAt, when);
  });

  it('handles null and primitives without throwing', () => {
    for (const v of [null, undefined, 0, false, 'x']) {
      assert.doesNotThrow(() => stripInlineData(v));
    }
  });
});

describe('capPayload', () => {
  it('passes small payloads through untouched', () => {
    const r = capPayload({ a: 1 });
    assert.equal(r.truncated, false);
    assert.equal(r.stripped, 0);
    assert.deepEqual(JSON.parse(r.text), { a: 1 });
  });

  it('brings a multi-megabyte image payload under the ceiling by stripping alone', () => {
    const artifacts = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, title: `Design ${i}`, imageUrl: png(300) }));
    const r = capPayload({ artifacts }, 256 * 1024);
    assert.equal(r.stripped, 20);
    assert.equal(r.truncated, false, 'stripping should be enough — no data loss needed');
    // Every artifact survives; only the bytes are gone.
    assert.equal(JSON.parse(r.text).artifacts.length, 20);
  });

  it('always emits valid JSON, even when trimming', () => {
    const items = Array.from({ length: 4000 }, (_, i) => ({ id: i, note: 'x'.repeat(200) }));
    const r = capPayload({ items }, 64 * 1024);
    assert.equal(r.truncated, true);
    assert.doesNotThrow(() => JSON.parse(r.text));
    assert.ok(byteLength(r.text) <= 64 * 1024);
  });

  it('states the truncation IN the payload, so a partial list cannot read as complete', () => {
    const items = Array.from({ length: 4000 }, (_, i) => ({ id: i, note: 'x'.repeat(200) }));
    const parsed = JSON.parse(capPayload({ items }, 64 * 1024).text) as Record<string, unknown>;
    assert.equal(parsed._truncated, true);
    assert.match(String(parsed._truncationNote), /partial result/);
    assert.match(String(parsed._truncationNote), /Kept \d+ of \d+ entries/);
  });

  it('keeps entries intact rather than truncating individual records', () => {
    const items = Array.from({ length: 4000 }, (_, i) => ({ id: i, note: 'x'.repeat(200) }));
    const parsed = JSON.parse(capPayload({ items }, 64 * 1024).text) as { items: { id: number; note: string }[] };
    assert.ok(parsed.items.length < 4000);
    for (const it of parsed.items) assert.equal(it.note.length, 200);
  });

  it('truncates an over-long string result with a visible marker', () => {
    const r = capPayload('y'.repeat(200_000), 10_000);
    assert.equal(r.truncated, true);
    assert.ok(byteLength(r.text) <= 10_000);
    assert.match(r.text, /truncated/);
  });

  it('clips a single fat object under the limit rather than refusing it', () => {
    // Previously this returned an error: no array to halve meant nothing to do. Refusing a result the
    // caller can still use is the worse outcome, so the string trimmer handles it now.
    const r = capPayload({ blob: 'z'.repeat(200_000) }, 10_000);
    assert.equal(r.truncated, true);
    const parsed = JSON.parse(r.text) as { error?: string; blob?: string };
    assert.equal(parsed.error, undefined);
    assert.ok(byteLength(r.text) <= 10_000);
    assert.match(String(parsed.blob), /truncated/);
  });

  it('still emits valid JSON if a payload somehow resists every reduction', () => {
    // The error branch is close to unreachable now, but it must never emit malformed JSON if it fires.
    const r = capPayload({ a: 'x'.repeat(50_000) }, 300);
    assert.doesNotThrow(() => JSON.parse(r.text));
    assert.equal(r.truncated, true);
  });

  it('drops whole records rather than mangling every record, when a list is over budget', () => {
    // The shape that broke on 8x8: a list whose LONGEST array is nested inside one row. Trimming by
    // length chewed through each row's internals and left ten damaged records; trimming by depth drops
    // whole rows and leaves the survivors intact.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `artifact-${i}`,
      componentSpecMd: 'x'.repeat(14_000),
      componentSpec: { content: { textInventory: Array.from({ length: 48 }, (_, j) => ({ text: `line ${j} `.repeat(20) })) } },
      conversationHistory: [{ role: 'user', prompt: 'y'.repeat(4_000) }],
    }));
    // Sanity-check the fixture actually exercises the path — an under-budget payload passes trivially.
    assert.ok(byteLength(JSON.stringify(rows, null, 2)) > 256 * 1024, 'fixture must exceed the limit');
    const parsed = JSON.parse(capPayload(rows, 256 * 1024).text) as {
      items?: { componentSpec: { content: { textInventory: unknown[] } } }[];
      error?: string;
    };
    assert.equal(parsed.error, undefined, 'must not give up on a payload that is only ~30% over');
    assert.ok(parsed.items && parsed.items.length < 10, 'should have dropped rows');
    // Whatever survives is whole — a half-populated text inventory is a lie about the design.
    for (const row of parsed.items!) assert.equal(row.componentSpec.content.textInventory.length, 48);
  });

  it('names the dropped records in terms a caller can act on', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, blob: 'x'.repeat(40_000) }));
    const parsed = JSON.parse(capPayload(rows, 64 * 1024).text) as { _truncationNote?: string };
    assert.match(String(parsed._truncationNote), /Kept \d+ of 10 entries in "items"/);
  });

  it('clips long strings when there is no array to drop, instead of giving up', () => {
    // get_component('badge') on 8x8: one object, 466KB, almost all of it source. The trimmer had no
    // array to cut and returned an error — no result at all, when the caller wanted the properties.
    const component = {
      id: 'badge',
      properties: { variant: { type: 'enum', options: ['info', 'success'] } },
      code: 'x'.repeat(200_000),
      html: 'y'.repeat(180_000),
    };
    const parsed = JSON.parse(capPayload(component, 256 * 1024).text) as Record<string, unknown>;
    assert.equal(parsed.error, undefined, 'must return something usable');
    assert.equal(parsed.id, 'badge', 'the small, useful fields must survive');
    assert.match(String(parsed._truncationNote), /Truncated "code"/);
  });

  it('does not shorten a small array to save a rounding error', () => {
    // Regression: trimming dropped an enum option to reclaim ten bytes. A clipped source string is
    // honest about being clipped; a silently shortened enum is a lie about the component's contract.
    const component = {
      properties: { variant: { type: 'enum', options: ['info', 'success', 'warning'] } },
      code: 'x'.repeat(400_000),
    };
    const parsed = JSON.parse(capPayload(component, 256 * 1024).text) as {
      properties: { variant: { options: string[] } };
    };
    assert.deepEqual(parsed.properties.variant.options, ['info', 'success', 'warning']);
  });

  it('names the clipped field so the caller can re-request it', () => {
    const parsed = JSON.parse(capPayload({ sass: 'z'.repeat(400_000) }, 64 * 1024).text) as { sass?: string };
    assert.match(String(parsed.sass), /sass truncated — request this field on its own/);
  });

  it('terminates on deeply nested arrays rather than looping', () => {
    const nested = { a: Array.from({ length: 500 }, () => ({ b: Array.from({ length: 50 }, () => 'x'.repeat(100)) })) };
    assert.doesNotThrow(() => capPayload(nested, 8 * 1024));
  });
});
