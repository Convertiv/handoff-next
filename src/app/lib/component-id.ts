/** Max length for `handoff_component.id` (slug). */
export const COMPONENT_ID_MAX_LENGTH = 128;

/**
 * Allowed component IDs: lowercase alphanumeric, hyphens inside; must start with [a-z0-9].
 * Prevents path traversal and odd filesystem names.
 */
export const COMPONENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function isValidComponentId(id: string): boolean {
  const t = id.trim();
  return t.length > 0 && t.length <= COMPONENT_ID_MAX_LENGTH && COMPONENT_ID_PATTERN.test(t);
}
