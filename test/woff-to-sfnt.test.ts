import assert from 'node:assert';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { isSfnt, isWoff, isWoff2, toSatoriFont, woffToSfnt } from '../src/app/lib/server/woff-to-sfnt';

/**
 * Build a minimal but structurally valid sfnt from named tables, then wrap it as WOFF — so the
 * converter is tested by round-trip against data this test constructed, rather than against a
 * fixture whose correctness we'd be assuming.
 */
function buildSfnt(tables: { tag: string; data: Buffer }[], flavor = 0x00010000): Buffer {
  const sorted = [...tables].sort((a, b) => a.tag.localeCompare(b.tag));
  const n = sorted.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;

  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(n * 16 - searchRange, 10);

  const dir = Buffer.alloc(n * 16);
  const body: Buffer[] = [];
  let cursor = 12 + n * 16;

  sorted.forEach((t, i) => {
    const p = i * 16;
    dir.write(t.tag, p, 4, 'ascii');
    dir.writeUInt32BE(0x12345678, p + 4); // checksum — arbitrary but must survive the round trip
    dir.writeUInt32BE(cursor, p + 8);
    dir.writeUInt32BE(t.data.byteLength, p + 12);
    body.push(t.data);
    cursor += t.data.byteLength;
    const pad = (4 - (t.data.byteLength % 4)) % 4;
    if (pad) {
      body.push(Buffer.alloc(pad));
      cursor += pad;
    }
  });

  return Buffer.concat([header, dir, ...body]);
}

/** Wrap tables as WOFF. `compress: false` exercises the stored-table path. */
function buildWoff(tables: { tag: string; data: Buffer }[], opts: { compress?: boolean; flavor?: number } = {}): Buffer {
  const compress = opts.compress ?? true;
  const flavor = opts.flavor ?? 0x00010000;
  const sorted = [...tables].sort((a, b) => a.tag.localeCompare(b.tag));
  const n = sorted.length;

  const entries = sorted.map((t) => {
    const comp = compress ? zlib.deflateSync(t.data) : t.data;
    // Per spec, a table is stored uncompressed when compLength === origLength.
    const useComp = compress && comp.byteLength < t.data.byteLength;
    return { tag: t.tag, orig: t.data, payload: useComp ? comp : t.data, origLength: t.data.byteLength };
  });

  const header = Buffer.alloc(44);
  header.writeUInt32BE(0x774f4646, 0); // 'wOFF'
  header.writeUInt32BE(flavor, 4);
  header.writeUInt16BE(n, 12);

  const dir = Buffer.alloc(n * 20);
  const body: Buffer[] = [];
  let cursor = 44 + n * 20;

  entries.forEach((e, i) => {
    const p = i * 20;
    dir.write(e.tag, p, 4, 'ascii');
    dir.writeUInt32BE(cursor, p + 4);
    dir.writeUInt32BE(e.payload.byteLength, p + 8);
    dir.writeUInt32BE(e.origLength, p + 12);
    dir.writeUInt32BE(0x12345678, p + 16);
    body.push(e.payload);
    cursor += e.payload.byteLength;
    const pad = (4 - (e.payload.byteLength % 4)) % 4;
    if (pad) {
      body.push(Buffer.alloc(pad));
      cursor += pad;
    }
  });

  const out = Buffer.concat([header, dir, ...body]);
  out.writeUInt32BE(out.byteLength, 8);
  return out;
}

const TABLES = [
  { tag: 'cmap', data: Buffer.from('cmap-table-contents-that-compress-well-aaaaaaaaaaaa') },
  { tag: 'glyf', data: Buffer.from('glyf-outline-data-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') },
  { tag: 'head', data: Buffer.from('head1234') },
  { tag: 'name', data: Buffer.from('PP Telegraf') },
];

/** Read an sfnt back into { tag -> data }, so assertions are about content not byte layout. */
function readSfntTables(buf: Buffer): Record<string, Buffer> {
  const n = buf.readUInt16BE(4);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < n; i += 1) {
    const p = 12 + i * 16;
    const tag = buf.subarray(p, p + 4).toString('ascii');
    const offset = buf.readUInt32BE(p + 8);
    const length = buf.readUInt32BE(p + 12);
    out[tag] = buf.subarray(offset, offset + length);
  }
  return out;
}

describe('format detection', () => {
  it('recognizes WOFF, WOFF2 and sfnt', () => {
    assert.equal(isWoff(buildWoff(TABLES)), true);
    assert.equal(isSfnt(buildSfnt(TABLES)), true);
    const woff2 = Buffer.alloc(8);
    woff2.writeUInt32BE(0x774f4632, 0);
    assert.equal(isWoff2(woff2), true);
    assert.equal(isWoff(woff2), false);
  });

  it('recognizes CFF/OpenType flavour as sfnt', () => {
    assert.equal(isSfnt(buildSfnt(TABLES, 0x4f54544f)), true);
  });

  it('does not crash on short or junk buffers', () => {
    for (const b of [Buffer.alloc(0), Buffer.alloc(2), Buffer.from('not a font at all')]) {
      assert.equal(isWoff(b), false);
      assert.equal(woffToSfnt(b), null);
    }
  });
});

describe('woffToSfnt', () => {
  it('round-trips every table byte-for-byte through compression', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES, { compress: true }));
    assert.ok(sfnt);
    const tables = readSfntTables(sfnt);
    for (const t of TABLES) {
      assert.ok(tables[t.tag], `missing ${t.tag}`);
      assert.equal(tables[t.tag].toString(), t.data.toString(), `${t.tag} content differs`);
    }
  });

  it('handles stored (uncompressed) tables, where compLength === origLength', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES, { compress: false }));
    assert.ok(sfnt);
    const tables = readSfntTables(sfnt);
    assert.equal(tables.name.toString(), 'PP Telegraf');
  });

  it('produces a buffer that reads back as sfnt', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES));
    assert.ok(sfnt && isSfnt(sfnt));
  });

  it('preserves the sfnt flavour so CFF fonts stay CFF', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES, { flavor: 0x4f54544f }));
    assert.ok(sfnt);
    assert.equal(sfnt.readUInt32BE(0), 0x4f54544f);
  });

  it('preserves each table checksum from the WOFF directory', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES));
    assert.ok(sfnt);
    assert.equal(sfnt.readUInt32BE(12 + 4), 0x12345678);
  });

  it('sorts the directory by tag, as the sfnt spec requires', () => {
    const sfnt = woffToSfnt(buildWoff([...TABLES].reverse()));
    assert.ok(sfnt);
    const n = sfnt.readUInt16BE(4);
    const tags: string[] = [];
    for (let i = 0; i < n; i += 1) tags.push(sfnt.subarray(12 + i * 16, 12 + i * 16 + 4).toString('ascii'));
    assert.deepEqual(tags, [...tags].sort());
  });

  it('4-byte aligns table data', () => {
    const sfnt = woffToSfnt(buildWoff(TABLES));
    assert.ok(sfnt);
    const n = sfnt.readUInt16BE(4);
    for (let i = 0; i < n; i += 1) {
      assert.equal(sfnt.readUInt32BE(12 + i * 16 + 8) % 4, 0, 'table offset not 4-byte aligned');
    }
  });

  it('returns null when a table offset runs past the buffer', () => {
    const woff = buildWoff(TABLES);
    woff.writeUInt32BE(0xfffffff0, 44 + 4); // first entry's offset
    assert.equal(woffToSfnt(woff), null);
  });

  it('returns null when inflated length does not match origLength', () => {
    const woff = buildWoff(TABLES, { compress: true });
    woff.writeUInt32BE(999999, 44 + 12); // first entry's origLength
    assert.equal(woffToSfnt(woff), null);
  });
});

describe('toSatoriFont', () => {
  it('passes sfnt through untouched', () => {
    const sfnt = buildSfnt(TABLES);
    const r = toSatoriFont(sfnt);
    assert.ok('data' in r);
    assert.equal(r.converted, false);
    assert.equal(r.data, sfnt);
  });

  it('converts WOFF and flags that it did', () => {
    const r = toSatoriFont(buildWoff(TABLES));
    assert.ok('data' in r);
    assert.equal(r.converted, true);
    assert.ok(isSfnt(r.data));
  });

  it('reports WOFF2 as an error rather than degrading quietly', () => {
    const woff2 = Buffer.alloc(44);
    woff2.writeUInt32BE(0x774f4632, 0);
    const r = toSatoriFont(woff2);
    assert.ok('error' in r);
    assert.match(r.error, /WOFF2/);
  });

  it('reports an unrecognized container as an error', () => {
    const r = toSatoriFont(Buffer.from('definitely not a font'));
    assert.ok('error' in r);
    assert.match(r.error, /Unrecognized/);
  });
});
