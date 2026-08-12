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
}

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
    return rank(a) - rank(b) || (a.blockIndex ?? -1) - (b.blockIndex ?? -1);
  });

  return (
    <ul className="space-y-1.5">
      {ordered.map((finding, i) => {
        const blocking = finding.severity === 'blocking';
        const name = fieldName(finding);
        const canJump = Boolean(onSelect) && typeof finding.blockIndex === 'number';

        const where = [
          typeof finding.blockIndex === 'number' ? `Block ${finding.blockIndex + 1}` : null,
          name,
        ]
          .filter(Boolean)
          .join(' · ');

        const body = (
          <>
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
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
