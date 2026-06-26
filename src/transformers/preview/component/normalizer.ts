/**
 * Preview normalizer — Component+Preview standard, P1.
 *
 * Canonical previews are an ARRAY of objects with a stable `id` (see
 * docs/COMPONENT_PREVIEW_SCHEMA.md §13 decision #1). The legacy/runtime shape is
 * a keyed map (`{ [key]: { title, values, ... } }`, see OptionalPreviewRender).
 *
 * This normalizer is the **lenient intake adapter**: it accepts either shape and
 * returns the canonical array. Per the decided principle — *accept loose input,
 * normalize to canonical; never throw on a recoverable shape* — junk entries are
 * skipped rather than erroring, and ids are derived and de-duplicated.
 */

export interface NormalizedPreview {
  /** Stable slug. Precedence: explicit `id` → map key → slug(title) → `preview-N`. */
  id: string;
  title: string;
  values: Record<string, unknown>;
  /** Non-serializable render inputs (React node factories, etc.) — render-only. */
  slots?: Record<string, unknown>;
  /** Semantic tag (primary | secondary | …) — open vocabulary. */
  semantic?: string;
  /** Why this preview exists / when to use it. */
  rationale?: string;
  /** Preserved legacy fields. */
  url?: string;
  usage?: string;
  sourcePreview?: string;
  /** Any other fields are preserved as-is (e.g. $extensions, render). */
  [key: string]: unknown;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize previews (keyed-map OR array) to the canonical array-with-id.
 * Lenient: non-object entries are skipped, never thrown.
 */
export function normalizePreviews(input: unknown): NormalizedPreview[] {
  if (!input || typeof input !== 'object') return [];

  const entries: Array<[string | null, unknown]> = Array.isArray(input)
    ? input.map((p) => [null, p] as [string | null, unknown])
    : Object.entries(input as Record<string, unknown>);

  const out: NormalizedPreview[] = [];
  const usedIds = new Set<string>();

  entries.forEach(([key, raw], index) => {
    if (!isPlainObject(raw)) return; // lenient: skip junk entries

    const p = raw;
    const explicitId = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : '';
    const fromKey = typeof key === 'string' && key.trim() ? key.trim() : '';
    const fromTitle = typeof p.title === 'string' ? slugify(p.title) : '';
    let id = explicitId || fromKey || fromTitle || `preview-${index + 1}`;

    // De-duplicate ids deterministically.
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    usedIds.add(id);

    const values = isPlainObject(p.values) ? p.values : {};
    const title = typeof p.title === 'string' && p.title.trim() ? p.title : id;

    out.push({ ...p, id, title, values });
  });

  return out;
}
