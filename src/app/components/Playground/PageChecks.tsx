'use client';

import { Button } from '../ui/button';
import { FindingsList, type RenderableFinding } from './FindingsList';
import { requestFieldReveal } from './FieldLinkContext';
import { AUDIT_CATEGORY_LABEL, groupAuditFindings, type AuditCategory, type AuditFinding } from '@/lib/build-audits';

/**
 * What the app thinks of **this** page, on the page itself (Brad, 2026-08-13).
 *
 * The checks have always run. Until now the only surface showing them was `BuildPanel`, reachable only by
 * opening a submitted page *through the template it came from* — so a person looking at their own page from
 * the library saw no findings, no panel, and no evidence anything had been checked. That reads as the feature
 * being gone, which is what it effectively was.
 *
 * This is deliberately **not** `BuildPanel`. That panel is a reviewer's surface: it carries who submitted the
 * page, when, their message, and approve/reject. None of that exists for a page you made yourself. What both
 * want is the findings list, and that is what is shared — the same `FindingsList`, the same ordering, the same
 * badges, so the two never drift apart the way the guest and reviewer views once did.
 */
export default function PageChecks({
  audits = [],
  guardrailFindings = [],
  onClose,
}: {
  audits?: AuditFinding[];
  guardrailFindings?: RenderableFinding[];
  onClose?: () => void;
}) {
  /**
   * One list, not two sections — the same call `BuildPanel` made, for the same reason: a person asking "what
   * is wrong with this page" does not care which pass noticed. `groupAuditFindings` still supplies the
   * category, which rides on the row rather than becoming a heading.
   */
  const grouped = groupAuditFindings(audits);
  const allFindings: RenderableFinding[] = [
    ...(Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[]).flatMap((category) =>
      grouped[category].map((finding) => ({ ...finding, group: AUDIT_CATEGORY_LABEL[category] }))
    ),
    ...guardrailFindings.map((finding) => ({ ...finding, group: finding.group ?? 'Content rule' })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">
          Checks{allFindings.length ? ` (${allFindings.length})` : ''}
        </span>
        {onClose ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <FindingsList
          findings={allFindings}
          /**
           * Says what was checked, not just that nothing came back. "No issues found" alone claims more than
           * the passes actually cover — the same honesty E.10 asked for in the reviewer's panel.
           */
          emptyNote="No issues found in the accessibility, SEO and content checks."
          onSelect={requestFieldReveal}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          These run automatically on the saved page each time you open it.
        </p>
      </div>
    </div>
  );
}
