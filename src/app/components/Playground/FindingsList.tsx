'use client';

import { fieldLinkKey } from './FieldLinkContext';

/**
 * Findings, said where a person can act on them — roadmap E.11.
 *
 * **Why this is shared rather than written twice.** Two surfaces show findings and they were diverging: the
 * reviewer's build view listed audit findings as flat `<li>{message}</li>` text, and the guest's submit path showed
 * nothing at all — a blocking refusal arrived as `"Could not submit the page."` while the actual reasons sat in a
 * server log (Brad, 2026-08-11). Both audiences want the same three things: what is wrong, which block, and which
 * field.
 *
 * **It takes the intersection of the two finding types on purpose.** `GuardrailFinding` (blocking, from the submit
 * gate) and `AuditFinding` (advisory, from `build-audits.ts`) are produced by different passes for different
 * reasons, and unifying them into one type would force a shared vocabulary neither wants. They already agree on
 * `message` / `path` / `blockIndex`, so that agreement is the contract here and nothing else is assumed.
 *
 * Presentational by design: `onSelect` is optional, so a host that cannot act on a finding (no canvas beside it)
 * renders the same list as static text rather than offering a control that does nothing.
 */

export interface RenderableFinding {
  message: string;
  /** Dotted field path. Absent on page-level findings, which belong to no field. */
  path?: string | null;
  /** Zero-based block position. Absent on page-level findings. */
  blockIndex?: number | null;
  severity?: 'blocking' | 'advisory';
  /** Human field name when the producer knew one; otherwise derived from `path`. */
  label?: string;
  code?: string;
  /**
   * What kind of check produced this — "Accessibility", "SEO", "Content rule".
   *
   * Shown **per row** rather than as a section heading, which is what let the build view collapse two sections and
   * four category headings into one list without losing the information they carried. Four headings for five
   * findings is chrome; the same four words on the rows they describe is signal.
   */
  group?: string;
}

/**
 * Badge colour per kind of check (Brad, QA: *"drop the bullets … add color badges for the kind of check we ran"*).
 *
 * A bullet said nothing — every row got the same dot. The badge carries the one fact the row's meta line was
 * spending words on, so the kind is legible at a glance and the line below it gets shorter.
 */
const GROUP_TONE: Record<string, string> = {
  Voice: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Accessibility: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  SEO: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  Content: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'Content rule': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};
/** An unknown kind still gets a badge — neutral rather than absent, so rows stay aligned. */
const GROUP_TONE_FALLBACK = 'bg-muted text-muted-foreground';

/** `items.1.paragraph` → `Paragraph`. The last named segment is the one a person recognises. */
function fieldName(finding: RenderableFinding): string | null {
  if (finding.label) return finding.label;
  if (!finding.path) return null;
  const leaf = fieldLinkKey(finding.path).split('.').pop();
  if (!leaf) return null;
  return leaf.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function FindingsList({
  findings,
  onSelect,
  emptyNote,
}: {
  findings: RenderableFinding[];
  /**
   * Jump to the field a finding is about. When omitted the rows are inert text — see the note above about not
   * offering a control that cannot work.
   */
  onSelect?: (blockIndex: number, path: string | null) => void;
  emptyNote?: string;
}) {
  if (!findings.length) {
    return emptyNote ? <p className="text-xs text-muted-foreground">{emptyNote}</p> : null;
  }

  // Blocking first: those are the ones standing between the author and a submission.
  const ordered = [...findings].sort((a, b) => {
    const rank = (f: RenderableFinding) => (f.severity === 'blocking' ? 0 : 1);
    return (
      rank(a) - rank(b) ||
      (a.blockIndex ?? -1) - (b.blockIndex ?? -1) ||
      (a.group ?? '').localeCompare(b.group ?? '')
    );
  });

  return (
    <ul className="space-y-1.5">
      {ordered.map((finding, i) => {
        const blocking = finding.severity === 'blocking';
        const name = fieldName(finding);
        const canJump = Boolean(onSelect) && typeof finding.blockIndex === 'number';

        // The badge now carries the kind, so the meta line is only about *where*.
        const where = [
          typeof finding.blockIndex === 'number' ? `Block ${finding.blockIndex + 1}` : null,
          name,
        ]
          .filter(Boolean)
          .join(' · ');

        const body = (
          <>
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                GROUP_TONE[finding.group ?? ''] ?? GROUP_TONE_FALLBACK
              }`}
            >
              {finding.group ?? (blocking ? 'Blocking' : 'Check')}
            </span>
            <span className="min-w-0">
              <span className="block">{finding.message}</span>
              {where ? <span className="mt-0.5 block text-[11px] opacity-70">{where}</span> : null}
            </span>
          </>
        );

        const tone = blocking ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground';

        return (
          <li key={`${finding.code ?? 'f'}-${finding.path ?? 'page'}-${i}`} className={`text-xs ${tone}`}>
            {canJump ? (
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60 focus:outline-hidden focus:ring-1 focus:ring-ring"
                onClick={() => onSelect!(finding.blockIndex as number, finding.path ?? null)}
                title="Go to this field"
              >
                {body}
              </button>
            ) : (
              <span className="flex items-start gap-2 px-1 py-0.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default FindingsList;
