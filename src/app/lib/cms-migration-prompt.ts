import { manifestToMarkdown, type PageManifest } from './page-manifest';

/**
 * "Move this page to the CMS", as a prompt somebody pastes into an agent that holds both MCPs (reflow R.6).
 *
 * **Why a prompt rather than an adapter, first.** An adapter has to know the mapping — this Handoff block
 * becomes that HubSpot module, this field becomes that field — and nobody knows the mapping yet. Writing it
 * from imagination produces an integration that is confidently wrong in ways nobody notices until content is
 * live. A prompt costs days instead of weeks, and **every run teaches the mapping**: what the agent asks for,
 * what it gets wrong, what the target actually requires. Track B (`docs/PAGES-TEMPLATES-REFLOW.md` §5.2) then
 * encodes what was learned rather than what was assumed.
 *
 * **The instructions are mostly prohibitions**, and that is the design. The failure mode of an agent with write
 * access to a CMS is not that it refuses — it is that it invents a field, guesses a module, or silently drops
 * the third paragraph, and reports success. So: create nothing that was not asked for, map nothing you cannot
 * name, and say what you could not place.
 */

export type CmsTarget = 'hubspot' | 'sanity' | 'unknown';

const TARGET_NOTES: Record<CmsTarget, string> = {
  hubspot: [
    '## About the target (HubSpot)',
    '',
    'A HubSpot page is a **template with drag-and-drop areas**, filled by **modules**. Content does not exist',
    'loose on a page — every field belongs to a module instance. So the mapping you are working out is:',
    '',
    '1. which module type corresponds to each block below, and',
    '2. which module field corresponds to each field of that block.',
    '',
    'If no module matches a block, say so rather than forcing it into a rich-text module — dumping HTML into',
    'rich text technically works and destroys the editability that made this a CMS page in the first place.',
  ].join('\n'),
  sanity: [
    '## About the target (Sanity)',
    '',
    'A Sanity page is a **document of some type**, usually with an array of block objects. The mapping you are',
    'working out is which document type this page becomes, which object type each block becomes, and which',
    'field of that object each field below becomes.',
    '',
    '**Read the schema before writing anything.** Sanity schemas are project-specific: the types are whatever',
    'this studio defines, and guessing a type name produces a document that validates nowhere. If the schema is',
    'not reachable through the tools you hold, stop and say so.',
  ].join('\n'),
  unknown: [
    '## About the target',
    '',
    'Inspect the CMS you are connected to before writing anything: what a page is made of there, what its',
    'content types are called, and which of them corresponds to a block below. If you cannot establish that,',
    'stop and report it rather than creating something shaped like a guess.',
  ].join('\n'),
};

/**
 * @param manifest the page, from `buildPageManifest` — the content, and nothing about where it should go.
 * @param target which CMS, when the caller knows. `unknown` still produces a usable prompt.
 */
export function cmsMigrationPrompt(manifest: PageManifest, target: CmsTarget = 'unknown'): string {
  return [
    `# Move "${manifest.title || manifest.pageId}" into the CMS`,
    '',
    'You have this page\'s complete content below, and MCP tools for the target CMS. Work out how this content',
    'maps onto that CMS, then create the page there.',
    '',
    TARGET_NOTES[target],
    '',
    '## How to do it',
    '',
    '1. **Look at the target first.** List the content types, modules or components it actually has. Do not',
    '   plan a mapping against types you have not confirmed exist.',
    '2. **Propose the mapping before you create anything** — block by block, field by field — and say which',
    '   parts you are unsure about. A short table is fine.',
    '3. **Then create the page**, and report what you made with a link or an id.',
    '',
    '## Rules',
    '',
    '- **Do not invent content.** Every value you write must appear verbatim below. If a target field is',
    '  required and nothing here fits it, leave it empty and say so — an invented headline is worse than a gap,',
    '  because a gap is visible.',
    '- **Do not drop content silently.** Anything you could not place goes in a list at the end. That list is',
    '  the most useful thing you will produce: it is what a real integration would have to handle.',
    '- **Do not reformat copy.** Preserve wording, punctuation and line breaks exactly. Length limits in the',
    '  target are a reason to report a problem, not to edit somebody\'s words.',
    '- **Preserve order.** The blocks below are in the order they appear on the page.',
    '- **Images are referenced by URL.** Upload or link them as the target requires; do not regenerate them.',
    '- **Ask before anything destructive.** Creating a new page is expected. Overwriting or unpublishing an',
    '  existing one is not — confirm first.',
    '',
    '---',
    '',
    manifestToMarkdown(manifest),
  ].join('\n');
}

/** Parse a target from a query string or tool argument, tolerating anything unrecognised. */
export function toCmsTarget(value: unknown): CmsTarget {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw === 'hubspot' || raw === 'sanity' ? raw : 'unknown';
}
