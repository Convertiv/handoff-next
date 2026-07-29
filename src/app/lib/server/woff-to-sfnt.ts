import zlib from 'node:zlib';

// Deliberately NOT marked `server-only`: this is a pure byte-level function whose only dependency is
// node:zlib, so it cannot be bundled for the client regardless, and the guard would make it
// untestable from the repo-root test runner.

/**
 * Convert a WOFF font to bare sfnt (TTF/OTF) bytes.
 *
 * **Why.** The foundations sheet handed to the image model is rasterized by satori, which needs
 * sfnt data. Registry fonts, however, are pushed as *web* fonts — the schema's own example filename
 * is `subset-PPTelegraf-Regular.woff2` — so a design system's real typeface arrives as a WOFF/WOFF2
 * subset. When satori cannot use it, it silently falls back to Inter: the type specimens on the
 * sheet render in the wrong typeface, the model copies those letterforms, and the generated design
 * inherits them. Observed on 8x8 2026-07-29, where PP Telegraf resolved to a 26KB registry font
 * against Inter's 337KB full TTF, and every generated design came back with the wrong font.
 *
 * WOFF is a thin container: a 44-byte header, a table directory, and per-table zlib-compressed
 * (or stored) sfnt tables. Rebuilding the sfnt is mechanical and needs no dependency.
 *
 * **WOFF2 is deliberately NOT supported.** It uses Brotli plus transformed `glyf`/`loca` tables and
 * cannot be unwrapped this way; callers get null and should say so rather than degrade quietly.
 */

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'
const WOFF_HEADER_SIZE = 44;
const WOFF_ENTRY_SIZE = 20;
const SFNT_HEADER_SIZE = 12;
const SFNT_ENTRY_SIZE = 16;

/** True when the buffer is a WOFF we can convert. */
export function isWoff(buf: Buffer): boolean {
  return buf.byteLength >= 4 && buf.readUInt32BE(0) === WOFF_SIGNATURE;
}

/** True when the buffer is WOFF2, which this converter cannot handle. */
export function isWoff2(buf: Buffer): boolean {
  return buf.byteLength >= 4 && buf.readUInt32BE(0) === WOFF2_SIGNATURE;
}

/** True when the buffer already looks like bare sfnt (TrueType or CFF/OpenType). */
export function isSfnt(buf: Buffer): boolean {
  if (buf.byteLength < 4) return false;
  const v = buf.readUInt32BE(0);
  return (
    v === 0x00010000 || // TrueType
    v === 0x4f54544f || // 'OTTO' — CFF
    v === 0x74727565 || // 'true'
    v === 0x74746366 // 'ttcf' — collection; satori may still cope
  );
}

/**
 * Unwrap WOFF to sfnt. Returns null when the input isn't a WOFF, is WOFF2, or is malformed —
 * never throws, so a bad font degrades to the caller's fallback rather than failing a render.
 */
export function woffToSfnt(buf: Buffer): Buffer | null {
  try {
    if (!isWoff(buf) || buf.byteLength < WOFF_HEADER_SIZE) return null;

    const flavor = buf.readUInt32BE(4);
    const numTables = buf.readUInt16BE(12);
    if (numTables === 0) return null;

    const dirEnd = WOFF_HEADER_SIZE + numTables * WOFF_ENTRY_SIZE;
    if (buf.byteLength < dirEnd) return null;

    type Table = { tag: number; checksum: number; data: Buffer };
    const tables: Table[] = [];

    for (let i = 0; i < numTables; i += 1) {
      const p = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
      const tag = buf.readUInt32BE(p);
      const offset = buf.readUInt32BE(p + 4);
      const compLength = buf.readUInt32BE(p + 8);
      const origLength = buf.readUInt32BE(p + 12);
      const origChecksum = buf.readUInt32BE(p + 16);

      if (offset + compLength > buf.byteLength) return null;
      const raw = buf.subarray(offset, offset + compLength);

      // Per spec: compLength === origLength means the table is stored uncompressed.
      let data: Buffer;
      if (compLength === origLength) {
        data = Buffer.from(raw);
      } else {
        data = zlib.inflateSync(raw);
        if (data.byteLength !== origLength) return null;
      }

      tables.push({ tag, checksum: origChecksum, data });
    }

    // The sfnt table directory must be sorted by tag. WOFF requires this too, but don't rely on it.
    tables.sort((a, b) => a.tag - b.tag);

    // Binary-search fields in the sfnt header, per the OpenType spec.
    const entrySelector = Math.floor(Math.log2(numTables));
    const searchRange = 2 ** entrySelector * 16;
    const rangeShift = numTables * 16 - searchRange;

    const header = Buffer.alloc(SFNT_HEADER_SIZE);
    header.writeUInt32BE(flavor, 0);
    header.writeUInt16BE(numTables, 4);
    header.writeUInt16BE(searchRange, 6);
    header.writeUInt16BE(entrySelector, 8);
    header.writeUInt16BE(rangeShift, 10);

    const directory = Buffer.alloc(numTables * SFNT_ENTRY_SIZE);
    const body: Buffer[] = [];
    let cursor = SFNT_HEADER_SIZE + numTables * SFNT_ENTRY_SIZE;

    tables.forEach((t, i) => {
      const p = i * SFNT_ENTRY_SIZE;
      directory.writeUInt32BE(t.tag, p);
      directory.writeUInt32BE(t.checksum, p + 4);
      directory.writeUInt32BE(cursor, p + 8);
      directory.writeUInt32BE(t.data.byteLength, p + 12);

      body.push(t.data);
      cursor += t.data.byteLength;

      // Tables are 4-byte aligned; the padding is not counted in the directory length.
      const pad = (4 - (t.data.byteLength % 4)) % 4;
      if (pad) {
        body.push(Buffer.alloc(pad));
        cursor += pad;
      }
    });

    // NOTE: `head.checkSumAdjustment` is left as-is. It is a whole-font checksum that font
    // rasterizers do not validate, and recomputing it would mean rewriting the head table.
    return Buffer.concat([header, directory, ...body]);
  } catch {
    return null;
  }
}

/**
 * Normalize any registry font buffer to something satori can rasterize.
 *
 * Returns the reason on failure so the caller can log it — a wrong typeface on the foundations
 * sheet is invisible in the output but poisons every design generated from it, so this must never
 * fail quietly.
 */
export function toSatoriFont(buf: Buffer): { data: Buffer; converted: boolean } | { error: string } {
  if (isSfnt(buf)) return { data: buf, converted: false };
  if (isWoff2(buf)) {
    return { error: 'WOFF2 cannot be unwrapped server-side (Brotli + transformed glyf/loca). Push a TTF/OTF or WOFF.' };
  }
  if (isWoff(buf)) {
    const sfnt = woffToSfnt(buf);
    return sfnt ? { data: sfnt, converted: true } : { error: 'WOFF unwrap failed — malformed or unsupported table layout.' };
  }
  return { error: 'Unrecognized font container (not sfnt, WOFF, or WOFF2).' };
}
