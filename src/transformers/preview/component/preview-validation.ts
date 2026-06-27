/**
 * Preview value validation against a component contract (Component+Preview
 * standard, §6/§15). Pure — no I/O, no server deps — so it's the single shared
 * check used by the registry CRUD API (validate-on-write), push reconciliation
 * (re-validate registry previews against the new contract → drift), and tests.
 *
 * Reads the legacy/runtime property shape (`{ key: { enum?, rules? } }`) so it
 * works directly against `handoff_component.properties`.
 */

export interface PreviewValueError {
  key: string;
  message: string;
}

interface PropMeta {
  enum?: unknown[];
  rules?: { content?: { min?: number; max?: number } };
}

/**
 * Validate a preview's serializable `values` against the component's property
 * contract. Returns [] when valid. Checks: every value key is a declared
 * property; enum membership; string length rules. Mirrors the P1 schema
 * validator's referential checks.
 */
export function validatePreviewValues(
  values: Record<string, unknown> | null | undefined,
  properties: Record<string, PropMeta> | null | undefined
): PreviewValueError[] {
  const errors: PreviewValueError[] = [];
  const props = properties ?? {};
  const propKeys = new Set(Object.keys(props));

  for (const [key, val] of Object.entries(values ?? {})) {
    if (!propKeys.has(key)) {
      errors.push({ key, message: `"${key}" is not a declared property of this component` });
      continue;
    }
    const meta = props[key] ?? {};

    const allowed = meta.enum;
    if (Array.isArray(allowed) && allowed.length > 0) {
      const candidates = Array.isArray(val) ? val : [val];
      for (const v of candidates) {
        const isPrimitive = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
        if (isPrimitive && !allowed.includes(v)) {
          errors.push({
            key,
            message: `${JSON.stringify(v)} is not one of: ${allowed.map((a) => JSON.stringify(a)).join(', ')}`,
          });
        }
      }
    }

    const content = meta.rules?.content;
    if (content && typeof val === 'string') {
      if (typeof content.min === 'number' && val.length < content.min) {
        errors.push({ key, message: `must be at least ${content.min} characters` });
      }
      if (typeof content.max === 'number' && val.length > content.max) {
        errors.push({ key, message: `must be at most ${content.max} characters` });
      }
    }
  }

  return errors;
}

/** Slugify a title into a stable preview key. */
export function slugifyPreviewKey(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
