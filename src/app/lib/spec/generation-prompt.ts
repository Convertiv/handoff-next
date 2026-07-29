import type { ComponentSpec } from '../server/design-spec-types';

/**
 * Render a ComponentSpec back into an image-generation prompt.
 *
 * This is the inverse of spec generation, and the first real piece of spec-driven generation: today
 * the pipeline is prompt → image → spec, and the intended direction is intent → spec → image.
 *
 * It exists first as an **experiment**. Round-tripping a design — spec → prompt → image → spec′ —
 * and diffing spec against spec′ answers the question the whole spec-driven thesis rests on: *is the
 * specification sufficient to reconstruct the design?* If the round trip is faithful, the spec can
 * be the source of truth. If it is not, the diff names exactly what the spec fails to carry, which
 * is the art-direction gap made measurable.
 *
 * Two deliberate constraints:
 *
 *  1. **The original image is not referenced.** That would defeat the experiment. Everything here
 *     comes from the specification alone.
 *  2. **Observed values, not token names.** An image model cannot resolve `var(--spacing-8)`, so the
 *     token mapping is emitted as its concrete values with the token name only as a label. This is
 *     the one place in the system that deliberately prefers the observed value over the reference.
 */

type AnyRec = Record<string, unknown>;

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Group copy by where it sits, so the prompt describes regions rather than a flat list. */
function contentByLocation(spec: ComponentSpec): string[] {
  const items = spec.content?.textInventory ?? [];
  if (!items.length) return [];
  const groups = new Map<string, string[]>();
  for (const t of items) {
    const loc = clean(t.location) || 'unspecified';
    const line = `${clean(t.role) || 'text'}: "${clean(t.text)}"`;
    const list = groups.get(loc) ?? [];
    list.push(line);
    groups.set(loc, list);
  }
  return [...groups.entries()].map(([loc, lines]) => `- **${loc}**\n${lines.map((l) => `  - ${l}`).join('\n')}`);
}

/** Concrete values the generator can actually honour, labelled with the token they came from. */
function tokenLines(spec: ComponentSpec): string[] {
  const t = spec.tokens;
  if (!t) return [];
  const out: string[] = [];
  const push = (label: string, rows: { observed: string; usage: string; token: string | null }[] | undefined) => {
    for (const r of rows ?? []) {
      const observed = clean(r.observed);
      if (!observed) continue;
      out.push(`- ${label} ${observed} — ${clean(r.usage) || 'general'}${r.token ? ` (${r.token})` : ''}`);
    }
  };
  push('colour', t.colors);
  push('type', t.typography);
  push('spacing', t.spacing);
  push('radius', t.radii);
  return out;
}

/**
 * Imagery the design needs.
 *
 * Derived from props that clearly reference an image plus any media hints in the summary. Photographs
 * are the only genuine assets in a generated design (backgrounds, states, icons and sub-components
 * are all tokens, CSS or existing components), so this is deliberately narrow.
 */
function imageryLines(spec: ComponentSpec): string[] {
  const out: string[] = [];
  for (const p of spec.props ?? []) {
    const name = clean(p.name);
    const desc = clean(p.description);
    if (/image|photo|media|background|illustration|avatar/i.test(`${name} ${desc}`)) {
      out.push(`- \`${name}\`: ${desc || 'image content'}`);
    }
  }
  return out;
}

export interface SpecPromptOptions {
  /**
   * Free-text art direction — composition, crop, focal weight, mood.
   *
   * The specification deliberately does not model these; they are the qualities you point at rather
   * than describe. Whether they need a permanent home on the spec is exactly what the round-trip
   * experiment is meant to inform.
   */
  artDirection?: string | null;
}

export function buildGenerationPromptFromSpec(spec: ComponentSpec, opts: SpecPromptOptions = {}): string {
  const ov = (spec.overview ?? {}) as AnyRec;
  const sections: string[] = [];

  sections.push(
    `Design a ${clean(ov.type) || 'component'} named "${clean(ov.name) || 'Component'}"${
      clean(ov.designSystemGroup) ? ` for the ${clean(ov.designSystemGroup)} group` : ''
    }.`
  );

  if (clean(ov.summary)) sections.push(clean(ov.summary));
  else if (clean(ov.description)) sections.push(clean(ov.description));

  const structure = clean(spec.implementation?.cssNotes);
  if (structure) sections.push(`## Layout and structure\n${structure}`);

  const content = contentByLocation(spec);
  if (content.length) {
    sections.push(
      `## Exact copy — reproduce these strings verbatim, in these positions\n${content.join('\n')}`
    );
  }

  const tokens = tokenLines(spec);
  if (tokens.length) {
    sections.push(
      `## Exact visual values — use these precisely\n${tokens.join('\n')}\n\n` +
        `Do not substitute approximations for these values; they come from the design system.`
    );
  }

  const imagery = imageryLines(spec);
  if (imagery.length) {
    sections.push(`## Imagery required\n${imagery.join('\n')}`);
  }

  const variant = (spec.variants ?? []).find((v) => v.isDefault) ?? (spec.variants ?? [])[0];
  if (variant && clean(variant.description)) {
    sections.push(`## State to depict\n${clean(variant.name) || 'Default'}: ${clean(variant.description)}`);
  }

  if (clean(opts.artDirection)) {
    sections.push(`## Art direction\n${clean(opts.artDirection)}`);
  }

  sections.push(
    `## Rules\n` +
      `- Reproduce every copy string above exactly as written. Do not invent additional text, ` +
      `statistics, dates or labels.\n` +
      `- Use the stated colours, type sizes, spacing and radii precisely.\n` +
      `- Render a single, complete, production-quality composition — not a mockup grid, ` +
      `annotations, or multiple variants side by side.`
  );

  return sections.join('\n\n');
}
