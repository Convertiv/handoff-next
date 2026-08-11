/**
 * Write one value into a block's args at a path that may contain row indices — the second half of the inline-edit
 * join (roadmap F.2).
 *
 * `fieldIdToArgsPath` turns a mark id into a path; this puts the value there. Split out from the message handler
 * because the subtle part is **what an absent intermediate should become**: `['items', 1, 'paragraph']` has to
 * create an *array* at `items`, not an object with a `"1"` key, or the value lands somewhere the template's
 * `{{#each}}` never looks and the edit silently does nothing. That is testable; a closure inside a `useEffect` is
 * not.
 *
 * Returns a new object — the canvas re-renders from it, and mutating in place would leave React with no reason to
 * believe anything changed.
 */
export function setAtArgsPath(
  data: Record<string, unknown> | undefined | null,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  const next = structuredClone(data ?? {}) as Record<string, unknown>;
  if (!path.length) return next;

  let cursor: Record<string | number, unknown> = next as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const existing = cursor[key];
    // The *next* segment decides the kind: a number wants an array to index into. A non-object intermediate is
    // replaced rather than descended into — writing `author.name` where `author` holds a string used to throw.
    const wantsArray = typeof path[i + 1] === 'number';
    const usable =
      existing !== null && typeof existing === 'object' && Array.isArray(existing) === wantsArray;
    if (!usable) cursor[key] = wantsArray ? [] : {};
    cursor = cursor[key] as Record<string | number, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return next;
}
