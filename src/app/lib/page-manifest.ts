import { collectEditableText, collectImageSrcs, mergeBlockArgs, type PatternComponentEntry } from './guest-editable';

/**
 * A page, flattened to everything it actually ships: every string, every image, in reading order.
 *
 * **Two jobs, one artifact** (reflow R.6). It is the payload a CMS migration reasons from — "here is the
 * content, work out where it goes" — and it is the thing you hand a brand or legal reviewer, who cannot be
 * asked to click through a canvas to find the copy. The second use is why it is a *manifest* rather than a
 * CMS-shaped export: it must be readable by a person with no interest in HubSpot.
 *
 * **It reuses the collectors everything else uses.** `collectEditableText` and `collectImageSrcs` are what the
 * guest editor, the audits and the voice check all walk. A manifest that found a different set of strings than
 * the checks run against would be a second definition of "the content of this page", and the two would drift —
 * the failure this reflow has now hit four times in other guises.
 *
 * **Nothing is inferred about meaning.** A field is reported with its path, its label and its value, and no
 * guess about whether it is a heading or a subtitle. Whatever consumes this — a model, a person — is better
 * placed to judge that than a regex over field names, and a wrong guess here would be laundered into a
 * migration as fact.
 */

export interface ManifestField {
  /** Dotted path inside the block's args, so a consumer can address the value it is looking at. */
  path: string;
  /** Humanised from the path — what a person would call this field. */
  label: string;
  value: string;
  /** Character count of the value, since length is the constraint most CMS targets actually impose. */
  length: number;
}

export interface ManifestImage {
  src: string;
  /** Humanised from the path — what a person would call this slot. */
  label: string;
  width: number | null;
  height: number | null;
}

export interface ManifestBlock {
  /** Position on the page, 1-based, because this is read by people as often as by machines. */
  position: number;
  componentId: string;
  title: string;
  fields: ManifestField[];
  images: ManifestImage[];
}

export interface PageManifest {
  pageId: string;
  title: string;
  description: string | null;
  /** ISO-8601, stamped by the caller — this module never reads the clock. */
  generatedAt?: string;
  blocks: ManifestBlock[];
  totals: {
    blocks: number;
    fields: number;
    images: number;
    /** Total characters of copy. The single most useful number when sizing a migration. */
    characters: number;
  };
}

/**
 * Build the manifest.
 *
 * `overrides` are the per-block values the playground layers over a block's own args — the same merge
 * `mergeBlockArgs` does everywhere else, so what appears here is what the page renders rather than what the
 * component declares by default.
 */
export function buildPageManifest(input: {
  pageId: string;
  title: string;
  description?: string | null;
  blocks: PatternComponentEntry[];
  overrides?: unknown[];
  /** Component titles by id, when the caller has them. Falls back to the component id, never to a guess. */
  titles?: Record<string, string>;
}): PageManifest {
  const overrides = input.overrides ?? [];
  const blocks: ManifestBlock[] = input.blocks.map((entry, index) => {
    const args = mergeBlockArgs(entry, overrides[index]);
    return {
      position: index + 1,
      componentId: entry.id,
      title: input.titles?.[entry.id] ?? entry.id,
      fields: collectEditableText(args).map((f) => ({
        path: f.path.join('.'),
        label: f.label,
        value: f.value,
        length: f.value.length,
      })),
      /**
       * ⚠️ **No `alt` here, deliberately.** `collectImageSrcs` does not report one — alt text is a *string*, so
       * it is collected by `collectEditableText` and already appears among the fields above. Adding an `alt`
       * key to this shape meant reading one that was never there and printing "no alt text" for every image on
       * every page: a confident claim the collector never made.
       */
      images: collectImageSrcs(args).map((i) => ({
        src: i.src,
        label: i.label,
        width: i.width,
        height: i.height,
      })),
    };
  });

  return {
    pageId: input.pageId,
    title: input.title,
    description: input.description ?? null,
    blocks,
    totals: {
      blocks: blocks.length,
      fields: blocks.reduce((n, b) => n + b.fields.length, 0),
      images: blocks.reduce((n, b) => n + b.images.length, 0),
      characters: blocks.reduce((n, b) => n + b.fields.reduce((m, f) => m + f.length, 0), 0),
    },
  };
}

/**
 * The manifest as Markdown — the form a person reads and a model quotes back.
 *
 * Deliberately not a table: values run to paragraphs, and a table with a 600-character cell is unreadable in
 * every renderer. Headings and definition-style lines survive being pasted into a doc, which is where a content
 * review actually happens.
 */
export function manifestToMarkdown(manifest: PageManifest): string {
  // This document gets handed to people, and "1 images" is the kind of small wrongness that makes a reader
  // trust the rest of it less.
  const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const lines: string[] = [
    `# ${manifest.title || manifest.pageId}`,
    '',
    [
      count(manifest.totals.blocks, 'block'),
      count(manifest.totals.fields, 'text field'),
      count(manifest.totals.images, 'image'),
      count(manifest.totals.characters, 'character'),
    ].join(' · '),
  ];
  if (manifest.description) lines.push('', manifest.description);

  for (const block of manifest.blocks) {
    lines.push('', `## ${block.position}. ${block.title}`, '', `\`${block.componentId}\``);
    if (!block.fields.length && !block.images.length) {
      lines.push('', '_No content — this block is configuration only._');
      continue;
    }
    for (const field of block.fields) {
      lines.push('', `**${field.label}** · \`${field.path}\` · ${count(field.length, 'char')}`, '', field.value);
    }
    for (const image of block.images) {
      const size = image.width && image.height ? ` · ${image.width}×${image.height}` : '';
      // Alt text, where it exists, is one of the fields above — see the note on `ManifestImage`.
      lines.push('', `**${image.label}** · image${size}`, '', image.src);
    }
  }
  return lines.join('\n');
}
