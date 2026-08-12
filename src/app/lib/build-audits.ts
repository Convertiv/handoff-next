import {
  collectEditableText,
  collectImageSrcs,
  mergeBlockArgs,
  type PatternComponentEntry,
} from './guest-editable';
import { altForImagePath, LINKISH, WEAK_LINK_TEXT } from './authoring-guardrails';

/**
 * Standing quality checks on a built page — roadmap E.10.
 *
 * **Why this reads content, not rendered HTML.** The plan was to audit the exported HTML server-side. That
 * does not work: `constructComponentPreview` emits, for a React component, a `<script type="application/json">`
 * of props plus a client-side mount — the markup is produced in the browser, and `renderPreview` server-side
 * returns that same mount rather than DOM. There is no server-rendered DOM for React components anywhere in
 * the codebase, and the components in play are React. Auditing the export would have inspected a script tag.
 *
 * Reading the content values instead is also better for the reader: every finding carries the field path it
 * came from, so a reviewer can be pointed at the thing to fix rather than at a page.
 *
 * **How this differs from guardrails.** `authoring-guardrails.ts` is a *gate*: rules an author configured on
 * an invitation, enforced at submit, which can refuse a write. These are a *report*: they always run, they
 * never block, and nobody configures them. The two share their substrate (`collectEditableText`,
 * `collectImageSrcs`), the weak-link-text list and `altForImagePath`, so the overlapping judgements cannot
 * drift apart. The split matters in practice: guardrails' alt check only runs when a page *has* a
 * configuration, so on an ordinary internal page with no invitation nothing was checking alt text at all —
 * this always does, and only ever reports.
 *
 * **What is deliberately not here.** `voice` is declared as a category and produces nothing: checking copy
 * against a brand voice is a judgement an LLM makes against the brand-voice document, not something a regex
 * can assert. Shipping a fake version of it would be worse than an empty section that says so.
 */

export type AuditCategory = 'content' | 'accessibility' | 'seo' | 'voice';

export interface AuditFinding {
  category: AuditCategory;
  /** Machine-readable so a UI can group and a test can assert without matching prose. */
  code:
    | 'placeholder-text'
    | 'placeholder-image'
    | 'shouting'
    | 'repeated-copy'
    | 'thin-content'
    | 'missing-alt'
    | 'weak-link-text'
    /**
     * Copy that contradicts the brand voice — produced by `server/voice-audit.ts`, not by this module.
     *
     * The `voice` category was declared here from the start and deliberately produced nothing, because the
     * judgement needs an LLM reading the brand-voice document. The code belongs in this union anyway: a voice
     * finding is an `AuditFinding` and renders through the same list, which is precisely why filling the category
     * cost no UI work.
     */
    | 'voice-mismatch';
  /** Null for a page-level finding that belongs to no single block. */
  blockIndex: number | null;
  componentId: string | null;
  /** Dotted field path, or null when the finding is about the page rather than a field. */
  path: string | null;
  label: string;
  message: string;
}

/** Text that is obviously a stand-in rather than copy anyone meant to publish. */
const PLACEHOLDER_TEXT = [/lorem\s+ipsum/i, /\bdolor\s+sit\s+amet\b/i, /\bTBD\b/, /\bTODO\b/, /\bXXX+\b/];

/** Hosts that only ever serve stand-in imagery. */
const PLACEHOLDER_IMAGE_HOSTS = [/placehold\.co/i, /placeholder\.com/i, /placekitten\.com/i, /dummyimage\.com/i];

/** Below this, a page has not really been written yet. Words, across every text field. */
const THIN_CONTENT_WORDS = 30;

/**
 * Four or more consecutive all-caps words.
 *
 * The threshold exists to leave acronyms and short labels alone — "FAQ", "GET A DEMO" and "8x8 UCaaS" are not
 * shouting, and flagging them would train people to ignore the whole report.
 */
const SHOUTING = /(?:\b[A-Z][A-Z''-]{1,}\b[^A-Za-z0-9]+){3,}\b[A-Z][A-Z''-]{1,}\b/;

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether a field is *page copy*, as opposed to editable text that is not read as prose.
 *
 * Alt text is the case that matters: `collectEditableText` rightly includes it (someone writes it, and it can
 * absolutely contain placeholder junk), but it is not body copy. Counting it toward word totals inflates them,
 * and treating repeated alt as duplicate content produced findings like "Alt repeats copy already used in
 * block 2" against a page reusing one image — noise, found the first time this ran over real pages.
 */
function isPageCopy(path: (string | number)[]): boolean {
  return path[path.length - 1] !== 'alt';
}

export function auditBuild(blocks: PatternComponentEntry[], overrides: unknown[] = []): AuditFinding[] {
  const findings: AuditFinding[] = [];
  let totalWords = 0;
  /** Normalized text → where it appeared, for the repeated-copy check. */
  const seenText = new Map<string, { blockIndex: number; label: string }>();

  blocks.forEach((entry, blockIndex) => {
    const args = mergeBlockArgs(entry, overrides[blockIndex]);
    const base = { blockIndex, componentId: entry.id };

    for (const field of collectEditableText(args)) {
      const path = field.path.join('.');
      const value = field.value.trim();
      const pageCopy = isPageCopy(field.path);
      if (pageCopy) totalWords += words(value);

      const placeholder = PLACEHOLDER_TEXT.find((re) => re.test(value));
      if (placeholder) {
        findings.push({
          ...base,
          category: 'content',
          code: 'placeholder-text',
          path,
          label: field.label,
          message: `${field.label} still contains placeholder copy.`,
        });
      }

      if (SHOUTING.test(value)) {
        findings.push({
          ...base,
          category: 'content',
          code: 'shouting',
          path,
          label: field.label,
          message: `${field.label} is set in capitals — use sentence case and let styling do the emphasis.`,
        });
      }

      if (LINKISH.test(path) && WEAK_LINK_TEXT.has(value.toLowerCase())) {
        findings.push({
          ...base,
          category: 'accessibility',
          code: 'weak-link-text',
          path,
          label: field.label,
          message: `“${value}” doesn't say where the link goes — describe the destination.`,
        });
      }

      /**
       * Repeated copy, reported once against the **second** occurrence.
       *
       * Only for text of five words or more: shared button labels and eyebrows repeat legitimately all over a
       * page, and flagging "Book a demo" three times is noise, not a finding.
       */
      if (pageCopy && words(value) >= 5) {
        const key = value.toLowerCase().replace(/\s+/g, ' ');
        const first = seenText.get(key);
        if (first && first.blockIndex !== blockIndex) {
          findings.push({
            ...base,
            category: 'seo',
            code: 'repeated-copy',
            path,
            label: field.label,
            message: `${field.label} repeats copy already used in block ${first.blockIndex + 1} — duplicate text competes with itself in search.`,
          });
        } else if (!first) {
          seenText.set(key, { blockIndex, label: field.label });
        }
      }
    }

    for (const image of collectImageSrcs(args)) {
      const path = image.path.join('.');

      if (PLACEHOLDER_IMAGE_HOSTS.some((re) => re.test(image.src))) {
        findings.push({
          ...base,
          category: 'content',
          code: 'placeholder-image',
          path,
          label: image.label,
          message: `${image.label} is still a placeholder image.`,
        });
      }

      const alt = altForImagePath(args, image.path);
      if (typeof alt !== 'string' || !alt.trim()) {
        findings.push({
          ...base,
          category: 'accessibility',
          code: 'missing-alt',
          path,
          label: image.label,
          message: `${image.label} has no alt text — describe it for anyone using a screen reader.`,
        });
      }
    }
  });

  // Page-level, so it carries no block: it is a statement about the whole thing.
  if (blocks.length > 0 && totalWords < THIN_CONTENT_WORDS) {
    findings.push({
      category: 'seo',
      code: 'thin-content',
      blockIndex: null,
      componentId: null,
      path: null,
      label: 'Page',
      message: `The page has about ${totalWords} words — too little for search to make much of it.`,
    });
  }

  return findings;
}

/** Findings grouped for display, including the categories that found nothing. */
export function groupAuditFindings(findings: AuditFinding[]): Record<AuditCategory, AuditFinding[]> {
  const grouped: Record<AuditCategory, AuditFinding[]> = {
    content: [],
    accessibility: [],
    seo: [],
    voice: [],
  };
  for (const finding of findings) grouped[finding.category].push(finding);
  return grouped;
}
