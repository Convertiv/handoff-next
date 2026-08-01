/**
 * Shared vocabulary for describing a component property's editor type, expected shape, and a
 * shape-correct placeholder.
 *
 * Extracted from `create-server.ts`, where these were closures inside the MCP server and therefore
 * unreachable from anywhere else. The playground chat needs the same answers, and two callers deciding
 * independently what an `image` field looks like is exactly how they drift: one emits a bare URL, the
 * other `{ src, alt }`, and only one of them renders.
 *
 * Pure and dependency-free so it can be unit-tested and imported from either side.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The editor type a property declares, falling back through the shapes different sources use. */
export const editorOf = (m: any): string => m?.editorType ?? m?.type ?? m?.kind ?? 'any';

/** Whether a property is a visible content slot rather than configuration. */
export const isVisualSlot = (m: any): boolean =>
  ['richtext', 'text', 'image', 'slot'].includes(m?.editorType) || m?.type === 'React.ReactNode' || m?.kind === 'slot';

/**
 * Human-readable description of the JS shape a field expects.
 *
 * ⚠️ **Fallback only, and a guess by construction.** It maps a *declared* editor type to a prose shape,
 * so it asserts `{ src, alt }` for every field whose name matched /image/ in every component of every
 * registry — a claim about components nobody checked, and wrong often enough to cost a month of bugs.
 *
 * The real answer is the build-time probe: `scaffoldArgsForComponent` prefers a measured encoding from
 * the component's capability record and only reaches here when there is none. Delete this once probe
 * coverage is universal; until then it is what an unprobed component falls back to.
 */
export const shapeNote = (m: any): string => {
  switch (editorOf(m)) {
    case 'richtext': return 'HTML string, e.g. "<p>Copy with <b>bold</b></p>"';
    case 'text': case 'slot': case 'string': return 'string';
    case 'image': return '{ src, alt, width?, height? }';
    case 'button': return '{ label, href, variant? }';
    case 'link': return '{ label, href }';
    case 'select': case 'enum': return `one of: ${(m?.options ?? []).map((o: unknown) => JSON.stringify((o as { value?: unknown })?.value ?? o)).join(', ') || '(options)'}`;
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'array': return `array of ${m?.items?.editorType ?? m?.items?.type ?? 'items'}`;
    case 'object': return 'object';
    default: return editorOf(m);
  }
};

/** A shape-correct placeholder for a field, used when no base-preview value exists. */
export const placeholderValue = (m: any): unknown => {
  switch (editorOf(m)) {
    case 'richtext': return '<p>Placeholder copy</p>';
    case 'text': case 'slot': case 'string': return 'Text';
    case 'image': return { src: '', alt: '', width: 0, height: 0 };
    case 'button': return { label: 'Button', href: '#' };
    case 'link': return { label: 'Link', href: '#' };
    case 'select': case 'enum': { const o = m?.options?.[0]; return (o as { value?: unknown })?.value ?? o ?? ''; }
    case 'boolean': return false;
    case 'number': return 0;
    case 'array': return [];
    case 'object': return {};
    default: return null;
  }
};
