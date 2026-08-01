/**
 * Describe a JSON-native prop from its real preview value, with examples.
 *
 * The probe answers `React.ReactNode` slots. It deliberately ignores everything else, because a
 * concrete type is supposed to be self-describing — but nothing was actually describing it. Array and
 * object props reached the authoring model as `shapeNote`'s `"array of object"`, which names no keys
 * and gives no examples, and two live failures came straight out of that:
 *
 * - `image-gallery.images` (`ImageGalleryImage[]`) — the model generated three images and wrote them
 *   into a shape the component could not read, because nothing told it the items were `{ src, alt }`.
 * - `stats.stats` (`StatCard[]`) — the model put "Uptime Guarantee" in `stat` and "99.999%" in `sub`,
 *   exactly inverted. The key names alone do not say which is the number.
 *
 * **Examples are the point.** `{ stat, sub }` is ambiguous; `{ stat: "100", sub: "Countries" }` is not.
 * Preview values are trustworthy here in a way they are not for slots — the contamination found across
 * 8x8's catalog was serialized React elements, and those only ever appear in `ReactNode` props.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isElementish = (v: unknown): boolean =>
  isPlainObject(v) && (('props' in v && 'type' in v) || '_owner' in v || '$$typeof' in v);

/** How much of a sample value to show. Long enough to disambiguate, short enough to repeat per field. */
const MAX_EXAMPLE = 32;

/** Bookkeeping a component may switch on but nobody authors — `_key`, `_type`, and friends. */
const isBookkeeping = (key: string) => key.startsWith('_');

function exampleFor(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return `"${text.length > MAX_EXAMPLE ? `${text.slice(0, MAX_EXAMPLE)}…` : text}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * One line describing an object's authorable keys, with a sample for each.
 *
 * Nested objects collapse to their key list rather than recursing — this ships for every field of every
 * block in the catalog, and depth costs more than it explains.
 */
function describeObject(value: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (isBookkeeping(key)) continue;
    if (isElementish(v)) {
      parts.push(`${key}: HTML string`);
      continue;
    }
    if (Array.isArray(v)) {
      parts.push(`${key}: array`);
      continue;
    }
    if (isPlainObject(v)) {
      const inner = Object.keys(v).filter((k) => !isBookkeeping(k));
      parts.push(`${key}: { ${inner.join(', ')} }`);
      continue;
    }
    const example = exampleFor(v);
    parts.push(example ? `${key}: ${example}` : key);
  }
  return parts.length ? `{ ${parts.join(', ')} }` : '{ }';
}

/**
 * Describe an array or object prop from the value a real preview holds.
 *
 * Returns null when the value teaches nothing — an empty array, a missing preview, or a scalar the
 * declared type already covers. A caller with null should fall back rather than print something vague.
 */
export function describeJsonShape(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (!value.length) return null;
    const first = value[0];
    if (isPlainObject(first) && !isElementish(first)) {
      // The count matters as much as the shape: a live page came back with four stat objects whose
      // every field was blank, because "array" alone does not say each item needs authoring.
      return `array of ${describeObject(first)} — write EVERY item`;
    }
    if (typeof first === 'string') return 'array of plain strings — write EVERY item';
    return null;
  }

  if (isPlainObject(value) && !isElementish(value)) {
    const keys = Object.keys(value).filter((k) => !isBookkeeping(k));
    if (!keys.length) return null;
    return describeObject(value);
  }

  return null;
}
