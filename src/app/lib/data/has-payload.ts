/**
 * Whether a row's `data` blob actually carries a payload.
 *
 * **An empty object is not a payload.** Treating it as one is why every page composed over MCP read back as
 * `{ id }` with `blocks: 0` (found 2026-08-10 composing the ALPS `Resources` archetype through the MCP).
 * `handoff_create_page` writes `components` correctly and passes no `data`, so `data` lands as `{}` — and `{}`
 * is a non-null object, so a bare `r.data && typeof r.data === 'object'` check accepted it and returned it *as*
 * the record, shadowing the real columns. The write was never the problem; **six copies of that predicate
 * were**, across patterns and components.
 *
 * This lives on its own so there is one definition. The fallback path it now reaches — reconstructing from the
 * row's own columns — is strictly better than returning `{}`, so applying it everywhere carries no risk of
 * losing a payload that was really there.
 */
export function hasDataPayload(row: { data?: unknown } | null | undefined): boolean {
  const data = row?.data;
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length > 0;
}
