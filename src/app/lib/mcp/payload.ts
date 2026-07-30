/**
 * Size discipline for MCP tool responses.
 *
 * Measured on 8x8: `list_design_artifacts` returned **34 MB**, `get_design_artifact` 6.7 MB,
 * `get_design_job` 2.9 MB, `get_component_spec` 2.2 MB. Essentially all of it is base64 image data
 * inlined as `data:` URIs — bytes a model can do nothing with except pay for. A response that large
 * doesn't degrade the client, it breaks it, and when it doesn't break it, it evicts the actual context
 * the tool was called to provide.
 *
 * Two rules, applied to every tool result at the single choke point rather than tool by tool:
 *
 *  1. **No inline image bytes.** A `data:` URI is replaced by a descriptor — mime type and size — so
 *     the model can still reason about "there is a 1.2 MB PNG here" and, where the object carries a
 *     usable reference, fetch it properly.
 *  2. **A hard ceiling, honestly reported.** If the payload is still too large it is trimmed, and the
 *     trim is *stated in the payload*. Silent truncation is worse than a big response: a model that
 *     doesn't know a list was cut off will confidently answer from the visible part.
 *
 * Kept pure and free of `server-only` so the behaviour is testable.
 */

/** Default ceiling for a single tool response. Override with `HANDOFF_MCP_MAX_RESPONSE_KB`. */
export const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export function maxResponseBytes(): number {
  const kb = Number.parseInt(process.env.HANDOFF_MCP_MAX_RESPONSE_KB ?? '', 10);
  return Number.isFinite(kb) && kb > 0 ? kb * 1024 : DEFAULT_MAX_RESPONSE_BYTES;
}

const DATA_URI = /^data:([\w.+-]+\/[\w.+-]+)?(;[\w-]+=[\w-]+)*(;base64)?,/i;

/** Byte length of a string as it will actually be serialized. */
export const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');

const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))}KB`;

/**
 * Replace a `data:` URI with a description of what it was.
 *
 * The mime type and size are kept because they're the parts that inform a decision ("this design has a
 * PNG at 1.2 MB"); the payload is dropped because no downstream step can use base64 from a tool result.
 */
export function describeDataUri(value: string): string {
  const m = DATA_URI.exec(value);
  const mime = m?.[1] ?? 'application/octet-stream';
  return `[inline ${mime}, ${kb(byteLength(value))} omitted — request the artifact's asset URL instead]`;
}

export const isDataUri = (value: unknown): value is string => typeof value === 'string' && DATA_URI.test(value);

/**
 * Walk a structure replacing inline image data.
 *
 * Returns a new value; the input is never mutated, because tool handlers hand us objects they may still
 * be using (and in some cases rows they intend to write back).
 */
export function stripInlineData(value: unknown, stats: { stripped: number; bytesSaved: number } = { stripped: 0, bytesSaved: 0 }): { value: unknown; stripped: number; bytesSaved: number } {
  const walk = (v: unknown): unknown => {
    if (isDataUri(v)) {
      stats.stripped += 1;
      stats.bytesSaved += byteLength(v);
      return describeDataUri(v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      // Preserve non-plain objects (Date, Buffer) as-is; JSON.stringify already handles them, and
      // rebuilding them from their enumerable keys would corrupt them.
      if (!isPlainObject(v)) return v;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return { value: walk(value), stripped: stats.stripped, bytesSaved: stats.bytesSaved };
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export interface CapResult {
  text: string;
  /** Number of inline `data:` URIs replaced by descriptors. */
  stripped: number;
  /** Bytes removed by stripping. */
  bytesSaved: number;
  /** True when the payload still exceeded the ceiling and had to be trimmed. */
  truncated: boolean;
}

/**
 * Serialize a tool result under the ceiling.
 *
 * Order matters: strip first, because stripping is lossless for the model's purposes and almost always
 * enough. Only if the result is *still* over the limit do we trim, and then the cheapest useful thing is
 * to shorten the longest array — a list tool over budget is over budget because of item count, and
 * halving it repeatedly converges fast while keeping every item intact. An item-level truncation would
 * instead hand back malformed records.
 */
export function capPayload(data: unknown, limit = maxResponseBytes()): CapResult {
  if (typeof data === 'string') {
    // Strings are already the final text (markdown exports, guides). Trim from the end with a marker.
    if (byteLength(data) <= limit) return { text: data, stripped: 0, bytesSaved: 0, truncated: false };
    const kept = data.slice(0, limit - 200);
    return {
      text: `${kept}\n\n[truncated — response exceeded ${kb(limit)}; ${kb(byteLength(data) - byteLength(kept))} omitted]`,
      stripped: 0,
      bytesSaved: 0,
      truncated: true,
    };
  }

  const { value, stripped, bytesSaved } = stripInlineData(data);
  let text = JSON.stringify(value, null, 2) ?? 'null';
  if (byteLength(text) <= limit) return { text, stripped, bytesSaved, truncated: false };

  let current = value;
  const notes: string[] = [];
  // Two reduction strategies, in order of how much they cost the caller.
  //
  // Arrays first: dropping whole records loses entries but keeps every survivor intact and truthful.
  // When no array can help, the payload is one fat object whose bulk is in long strings — a component
  // row is mostly `code`/`html`/`sass`. Halving the longest string is lossy, but it is *far* better than
  // the alternative this replaces: `get_component('badge')` returned 466KB of mostly source and the
  // trimmer, having no array to cut, gave up and returned an error. No result is worse than a clipped
  // one — the caller usually wanted the properties, not the stylesheet.
  //
  // Bounded twice over: each pass strictly shrinks the payload, and the pass count is capped.
  for (let pass = 0; pass < 40 && byteLength(text) > limit; pass += 1) {
    const trimmed = halveLongestArray(current, notes) ?? halveLongestString(current, notes);
    if (!trimmed) break;
    current = trimmed;
    text = JSON.stringify(withNotes(current, notes, limit), null, 2) ?? 'null';
  }

  if (byteLength(text) > limit) {
    // Nothing left to trim structurally — a single huge object. Say so rather than emit invalid JSON.
    text = JSON.stringify(
      {
        error: `Response exceeded ${kb(limit)} and could not be reduced without corrupting it.`,
        hint: 'Request a narrower slice — a single component, a single artifact, or a specific field.',
        approximateSize: kb(byteLength(text)),
      },
      null,
      2
    );
  }

  return { text, stripped, bytesSaved, truncated: true };
}

/** Attach the truncation record to the payload itself, so a model cannot miss that it's partial. */
function withNotes(value: unknown, notes: string[], limit: number): unknown {
  const note = {
    _truncated: true,
    _truncationNote: `Response exceeded ${kb(limit)}. ${notes.join(' ')} Treat this as a partial result and narrow the request for the rest.`,
  };
  if (Array.isArray(value)) return { items: value, ...note };
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>), ...note };
  return { value, ...note };
}

/**
 * Halve one array, recording what was dropped. Returns null when nothing is left to cut.
 *
 * **Shallowest array wins, not longest.** Picking the longest looked reasonable and is wrong: on a list
 * of design artifacts the longest array is a `textInventory` nested inside one row, so trimming chewed
 * through every row's internals — mangling all ten records instead of returning five intact ones — and
 * on a real 335KB response from 8x8 it exhausted its passes and gave up entirely, turning a large
 * result into no result.
 *
 * Dropping whole records removes far more bytes per pass and truncates comprehensibly: "showing 5 of 10
 * artifacts" is something a caller can act on, "artifact 7's text inventory was halved" is not.
 */
function halveLongestArray(root: unknown, notes: string[]): unknown | null {
  let best: { arr: unknown[]; path: string; depth: number } | null = null;

  const find = (v: unknown, path: string, depth: number): void => {
    if (Array.isArray(v)) {
      // Shallower always beats deeper; same depth falls back to whichever is longer. The size floor
      // matters as much as the ordering: without it, trimming a component happily dropped an enum
      // option — `["info","success"]` became `["info"]` — to save ten bytes. A clipped source string is
      // honest about being clipped; a silently shortened enum is just wrong. Small arrays carry meaning
      // per entry, so they are left alone and the string trimmer takes over instead.
      const worthCutting = v.length > 1 && byteLength(JSON.stringify(v) ?? '') >= MIN_TRIMMABLE_ARRAY_BYTES;
      if (worthCutting && (!best || depth < best.depth || (depth === best.depth && v.length > best.arr.length))) {
        best = { arr: v, path: path || 'items', depth };
      }
      v.forEach((item, i) => find(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (v && typeof v === 'object' && isPlainObject(v)) {
      for (const [k, val] of Object.entries(v)) find(val, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  find(root, '', 0);
  if (!best) return null;

  const target = best as { arr: unknown[]; path: string; depth: number };
  const keep = Math.max(1, Math.floor(target.arr.length / 2));
  const dropped = target.arr.length - keep;
  notes.push(`Kept ${keep} of ${target.arr.length} entries in "${target.path}" (${dropped} omitted).`);

  const replace = (v: unknown): unknown => {
    if (v === target.arr) return target.arr.slice(0, keep);
    if (Array.isArray(v)) return v.map(replace);
    if (v && typeof v === 'object' && isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = replace(val);
      return out;
    }
    return v;
  };
  return replace(root);
}

/** Strings shorter than this are left alone — clipping them costs meaning and saves nothing. */
const MIN_TRIMMABLE_STRING = 400;

/**
 * Arrays whose whole serialized form is smaller than this are left alone.
 *
 * Dropping entries from a short array — enum options, a handful of variants — destroys meaning to
 * reclaim a rounding error. Only arrays big enough to matter are worth the loss.
 */
const MIN_TRIMMABLE_ARRAY_BYTES = 2048;

/**
 * Halve the longest string value in the structure, marking where it was cut.
 *
 * The fallback for a payload that is one large object rather than a long list — a component row whose
 * `code`, `html` and `sass` fields are most of its weight. Lossy by nature, so it only runs once
 * `halveLongestArray` has nothing left to drop, and it says which field it clipped so the caller can
 * re-request that field on its own.
 *
 * Returns null when no string is long enough to be worth cutting, which is what ends the loop.
 */
function halveLongestString(root: unknown, notes: string[]): unknown | null {
  let best: { text: string; path: string } | null = null;

  const find = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (byteLength(v) >= MIN_TRIMMABLE_STRING && (!best || v.length > best.text.length)) {
        best = { text: v, path: path || 'value' };
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => find(item, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === 'object' && isPlainObject(v)) {
      for (const [k, val] of Object.entries(v)) find(val, path ? `${path}.${k}` : k);
    }
  };
  find(root, '');
  if (!best) return null;

  const target = best as { text: string; path: string };
  const keep = Math.max(200, Math.floor(target.text.length / 2));
  if (keep >= target.text.length) return null;
  const clipped = `${target.text.slice(0, keep)}\n…[${target.path} truncated — request this field on its own for the full value]`;
  notes.push(`Truncated "${target.path}" to ${keep} of ${target.text.length} characters.`);

  // Replace by identity, so an identical string elsewhere in the payload is left untouched — only the
  // one field we measured and reported gets cut.
  let replaced = false;
  const replace = (v: unknown): unknown => {
    if (!replaced && v === target.text) {
      replaced = true;
      return clipped;
    }
    if (Array.isArray(v)) return v.map(replace);
    if (v && typeof v === 'object' && isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = replace(val);
      return out;
    }
    return v;
  };
  return replace(root);
}
