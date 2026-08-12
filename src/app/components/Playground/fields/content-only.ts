import { resolveFieldType } from './field-type';

/**
 * Hide configuration from an editor that may only change content — the guest build surface (Brad, 2026-08-06:
 * "Invites lock config - guests only edit content").
 *
 * Filters the *properties tree* rather than gating each field at render time, so nothing downstream needs to
 * know: `renderFormFields` recurses over whatever it is handed, and a field that was filtered out simply is
 * not there. One pure function, testable on its own, and no third capability context in the field layer.
 *
 * **Why this is more than tidiness.** An invitation is brand-controlled: a stakeholder filling in a page
 * should not be switching your theme from `deep-purple` or flipping a layout. And the `any`/unknown fallback
 * renders `RawJsonField` — a raw JSON editor over the block's args, which is an arbitrary-write surface past
 * every field-level rule we have. Locking it for guests closes a real hole, not just a cosmetic one.
 *
 * It also lines up with where Phase F's tracer can and cannot work: that traces text and images and
 * deliberately refuses enums, booleans and numbers (a sentinel there corrupts a class name or flips a branch).
 * With config locked, the traceable set *is* the guest-editable set, so inline editing has no blind spot on the
 * surface it matters most for.
 */

/** Field types a guest may edit: copy, imagery, and the calls to action that carry copy. */
const CONTENT_TYPES = new Set([
  'text',
  'string',
  'richtext',
  // `React.ReactNode` — where body copy lives on a React component.
  'slot',
  'image',
  'image-url',
  'video_file',
  // Both carry a label as their dominant part; a locked CTA would strand placeholder text on the page.
  'button',
  'link',
]);

/**
 * Config that is **declared as a bare string**, and so is invisible to a type check.
 *
 * Found by running this against a real component: `hero-split` declares `theme`, `layout` and `direction` as
 * `enum` (correctly locked), but `anchor` and `imageTheme` as `type: 'text'` — identical to a headline as far as
 * the type system is concerned. `anchor` is an HTML fragment id, so a guest editing it silently breaks in-page
 * navigation; `imageTheme` is a styling token that only accepts certain values.
 *
 * This is a **heuristic and the weak point of the approach**, kept deliberately narrow: exact names plus a
 * `*Theme` suffix, nothing clever. The real fix is for config-ness to be declared rather than guessed — either
 * on `rules` or through the generated field annotations (roadmap F.4) — at which point this list goes away.
 */
const CONFIG_BY_NAME = new Set(['anchor', 'id', 'slug', 'class', 'className']);
const CONFIG_NAME_SUFFIX = /theme$/i;

function isConfigByName(key: string): boolean {
  return CONFIG_BY_NAME.has(key) || CONFIG_NAME_SUFFIX.test(key);
}

/** Containers are neither content nor config — they are kept only if something editable survives inside. */
const CONTAINER_TYPES = new Set(['object', 'array']);

/**
 * A filtered copy of `properties` containing only content fields.
 *
 * Containers are recursed into and dropped when empty, so a group of nothing but toggles disappears rather
 * than rendering as an empty labelled box.
 */
export function contentOnlyProperties(properties: unknown): Record<string, unknown> {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    // Config declared as a plain string cannot be told apart by type — see `CONFIG_BY_NAME`.
    if (isConfigByName(key)) continue;
    // Resolved with the same function the renderer uses, so what is hidden cannot drift from what is drawn.
    const type = resolveFieldType(prop);

    if (CONTENT_TYPES.has(type)) {
      out[key] = prop;
      continue;
    }

    if (CONTAINER_TYPES.has(type)) {
      const kept: Record<string, unknown> = { ...prop };
      let anything = false;

      if (prop.properties) {
        const nested = contentOnlyProperties(prop.properties);
        if (Object.keys(nested).length) {
          kept.properties = nested;
          anything = true;
        } else {
          delete kept.properties;
        }
      }

      const items = prop.items as Record<string, unknown> | undefined;
      if (items && typeof items === 'object') {
        if (items.properties) {
          const nestedItems = contentOnlyProperties(items.properties);
          if (Object.keys(nestedItems).length) {
            kept.items = { ...items, properties: nestedItems };
            anything = true;
          }
        } else if (CONTENT_TYPES.has(resolveFieldType(items))) {
          // An array of bare strings — the item descriptor is itself the leaf.
          kept.items = items;
          anything = true;
        }
      }

      if (anything) out[key] = kept;
      continue;
    }

    // Everything else is configuration or an escape hatch: enums, booleans, numbers, functions, and the
    // `any`/unknown case that renders a raw JSON editor. Dropped without comment — a disabled control would
    // only invite someone to ask why they cannot use it.
  }

  return out;
}
