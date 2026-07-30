/**
 * How real pages on this design system's live site are actually built.
 *
 * The point of the playground is to stop people designing new and start them composing from what
 * exists — and a model with a 79-block catalog and no idea what a finished page looks like will reach
 * for the same five blocks every time. Ours produced hero → stats → cards → CTA. The real product page
 * has **fifteen** sections and uses a whole vocabulary the model never touched: integration logos,
 * analyst recognition, security badges, resources, FAQ.
 *
 * Showing beats telling. These are observed structures, not invented best practice — derived from
 * 8x8's `/products/unified-communications`, `/solutions/connect-your-people` and a customer story on
 * 2026-07-30 (see `docs/8X8-VOICE-OBSERVED.md`).
 *
 * **Data, not prose, so they stay editable when the site changes.** They are also deliberately
 * *shapes* rather than block ids: naming exact components would rot the moment the catalog does, and
 * the model already has the catalog in front of it. What it lacks is the rhythm.
 *
 * ⚠️ **These are 8x8's, and they should not live here.** Handoff is multi-tenant; hardcoding one
 * client's page architecture into the shared app imposes it on every other registry. They belong in
 * workspace settings beside `designMd` and `brandVoice`, authored per project and written over MCP —
 * see "Phase 3.5" in `docs/PLAYGROUND-PLAN.md`. Treat this file as a temporary home, and do not add
 * more client-specific structures to it.
 */

export interface ExemplarSection {
  /** What this section does, in the language someone would use to ask for it. */
  purpose: string;
  /** Background treatment, expressed as the theme family rather than an exact token. */
  tone: 'brand' | 'dark' | 'light' | 'white';
  /** Roughly how many items, when it is a grid or list. */
  items?: number;
}

export interface PageExemplar {
  name: string;
  whenToUse: string;
  sections: ExemplarSection[];
  notes?: string[];
}

export const PAGE_EXEMPLARS: PageExemplar[] = [
  {
    name: 'Product page',
    whenToUse: 'A product or platform capability — the main marketing page for a thing you sell.',
    sections: [
      { purpose: 'Hero: product name, one-line promise, single CTA', tone: 'brand' },
      { purpose: 'Supporting image or product shot', tone: 'brand' },
      { purpose: 'Stats — the proof numbers', tone: 'light', items: 3 },
      { purpose: 'Three-up: how it fits how people actually work', tone: 'white', items: 3 },
      { purpose: 'The deep feature section — the main argument, several reasons', tone: 'light', items: 6 },
      { purpose: 'Mid-page CTA band: see it, try it', tone: 'brand' },
      { purpose: 'Feature grid: what teams unlock', tone: 'dark', items: 4 },
      { purpose: 'Stages or journey: built for every stage', tone: 'white', items: 4 },
      { purpose: 'FAQ — the objections a buyer actually has', tone: 'dark', items: 4 },
      { purpose: 'Resources or recent news', tone: 'white', items: 3 },
      { purpose: 'Integration logos', tone: 'white', items: 6 },
      { purpose: 'Analyst or industry recognition', tone: 'white', items: 3 },
      { purpose: 'Security and compliance badges', tone: 'white', items: 6 },
      { purpose: 'Final CTA', tone: 'brand' },
    ],
    notes: [
      'Stats come immediately after the hero on every page observed.',
      'The deep feature section is by far the tallest — around a third of the page.',
    ],
  },
  {
    name: 'Solution / use-case page',
    whenToUse: 'An outcome or audience rather than a product — "connect your people", an industry page.',
    sections: [
      { purpose: 'Hero: the outcome, stated plainly', tone: 'brand' },
      { purpose: 'Why this matters — name the problem before selling the fix', tone: 'light' },
      { purpose: 'How it works', tone: 'white', items: 3 },
      { purpose: 'What your team can do with it', tone: 'light', items: 4 },
      { purpose: 'The capability behind it — the platform argument', tone: 'dark' },
      { purpose: 'Proof: a customer quote or stats', tone: 'white' },
      { purpose: 'Final CTA', tone: 'brand' },
    ],
    notes: ['Shorter than a product page. The problem statement early is what makes it a solution page.'],
  },
  {
    name: 'Customer story',
    whenToUse: 'A named customer and what changed for them.',
    sections: [
      { purpose: 'Hero: customer name and the one-sentence outcome', tone: 'brand' },
      { purpose: 'Three headline results', tone: 'light', items: 3 },
      { purpose: 'The narrative, as several anchored sections with a contents list', tone: 'white', items: 6 },
      { purpose: 'Pull quote from a named person with their job title', tone: 'light' },
      { purpose: 'Related customer stories', tone: 'white', items: 3 },
    ],
    notes: [
      'The narrative sections are prose with headings, not feature cards.',
      'The quote carries a real name and role, never an anonymous testimonial.',
    ],
  },
];

/**
 * Render the exemplars for a prompt.
 *
 * Compact — this ships on every turn, so it earns its place by being the difference between a
 * five-section page and one that looks like the site.
 */
export function formatExemplars(exemplars: PageExemplar[] = PAGE_EXEMPLARS): string {
  return exemplars
    .map((ex) => {
      const rows = ex.sections
        .map((s, i) => `  ${i + 1}. ${s.purpose}${s.items ? ` (${s.items} items)` : ''} — ${s.tone} background`)
        .join('\n');
      const notes = ex.notes?.length ? `\n  Notes: ${ex.notes.join(' ')}` : '';
      return `**${ex.name}** — ${ex.whenToUse}\n${rows}${notes}`;
    })
    .join('\n\n');
}
