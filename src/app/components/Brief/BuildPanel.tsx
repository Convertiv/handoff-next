'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { handoffApiUrl } from '@/lib/api-path';
import type { BuildRow } from './BuildList';
import { AUDIT_CATEGORY_LABEL as CATEGORY_LABEL, groupAuditFindings, type AuditCategory, type AuditFinding } from '@/lib/build-audits';
import { FindingsList, type RenderableFinding } from '../Playground/FindingsList';
import PageNotes from '../library/PageNotes';
import { LIFECYCLE_META } from '@/lib/authz/vocab';
import { requestFieldReveal } from '../Playground/FieldLinkContext';

/**
 * The left panel at **build level** (roadmap E.8): what the builder said, and what we make of it.
 *
 * Carries over the verdict and download logic from the retired `BriefViewer`, which was a separate route with
 * its own shell. Same actions, same canvas, one interface.
 *
 * The checks section is filled by `build-audits.ts` (roadmap E.10) — computed server-side on the stored record
 * and handed down, so the panel does no work and cannot show a stale result.
 */

/** Why a category is empty, which is different from it having passed. */
/**
 * The one per-category note that carried information, kept when the categories stopped being headings.
 *
 * Merging the findings sections replaced four empty-states with a single "No issues found." — which would quietly
 * imply that voice *was* checked. It is not: judging copy against a brand voice is an LLM's job, and E.10 shipped
 * the category deliberately empty rather than showing a reassuring tick for a check that does not run
 * (`build-audits.ts`). Saying so is the honest version of a clean result.
 */
const VOICE_NOT_CHECKED = 'Voice and tone aren’t checked automatically yet — that needs a read against your brand voice.';

/** The provenance record as the review endpoint flattens it — never the fork-time blocks, which are page-sized. */
interface ProvenanceView {
  templateId: string | null;
  forkedAt: string | null;
  submittedAt: string | null;
  submittedByEmail: string | null;
  legacy: boolean;
  findingsAtSubmit: { category: string; code: string; message: string }[];
}

export default function BuildPanel({
  build,
  basePath,
  audits = [],
  guardrailFindings = [],
  backLabel = 'Back to template',
  onBackToBrief,
}: {
  build: BuildRow;
  basePath: string;
  audits?: AuditFinding[];
  /**
   * Advisory guardrail findings — content rules that did not block the submission (roadmap E.11).
   *
   * A separate section rather than folded into the audit categories: these come from a different pass and
   * pretending they are audits would need a category none of them belongs to.
   */
  guardrailFindings?: RenderableFinding[];
  /**
   * What the back control says. A legacy chain goes back to a brief's list of builds; a page built the new way
   * goes back to the template it came from. The default says so; "builds" is not a word this product uses any
   * more (reflow R.4/R.5).
   */
  backLabel?: string;
  onBackToBrief: () => void;
}) {
  /**
   * The voice check, run on request (roadmap E.10 completion).
   *
   * Not run on view: every other audit is deterministic and free, this one costs money and about a second. Its
   * findings join the same list as everything else — they are `AuditFinding`s in the `voice` category, which the
   * list already knows how to render and make clickable.
   */
  const [voiceFindings, setVoiceFindings] = useState<AuditFinding[]>([]);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);

  /**
   * Audits and advisory guardrails as one list, each row carrying which check produced it.
   *
   * `groupAuditFindings` is still the source of the category label — the grouping is preserved as data and dropped
   * only as *layout*.
   */
  const grouped = groupAuditFindings(audits);
  const allFindings: RenderableFinding[] = [
    ...(Object.keys(CATEGORY_LABEL) as AuditCategory[]).flatMap((category) =>
      grouped[category].map((finding) => ({ ...finding, group: CATEGORY_LABEL[category] }))
    ),
    ...voiceFindings.map((finding) => ({ ...finding, group: 'Voice' })),
    ...guardrailFindings.map((finding) => ({ ...finding, group: 'Content rule' })),
  ];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runVoiceCheck = useCallback(async () => {
    setVoiceBusy(true);
    setVoiceNote(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(build.id)}/voice`), {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as { findings?: AuditFinding[]; ran?: boolean; reason?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'The voice check could not be completed.');
      setVoiceFindings(Array.isArray(json.findings) ? json.findings : []);
      // "Didn't run" is distinct from "found nothing", and saying so avoids a false all-clear.
      setVoiceNote(json.ran === false ? json.reason ?? 'Not checked.' : json.findings?.length ? null : 'Nothing flagged.');
    } catch (e) {
      setVoiceNote(e instanceof Error ? e.message : 'The voice check could not be completed.');
    } finally {
      setVoiceBusy(false);
    }
  }, [build.id]);

  const [status, setStatus] = useState(build.status);

  /**
   * Where this page came from (reflow R.4).
   *
   * Fetched here rather than threaded through the workbench: the panel showing the diff is the panel that has to
   * answer "against what?", and the review endpoint returns both together. One request, on the one surface that
   * needs it.
   */
  const [prov, setProv] = useState<ProvenanceView | null>(null);
  const [templateMoved, setTemplateMoved] = useState<boolean | null>(null);
  const [comparedAgainst, setComparedAgainst] = useState<'as-handed' | 'template-now' | null>(null);
  /** "3 titles and 2 bodies changed, across every block." — the diff, before you read the diff. */
  const [digest, setDigest] = useState<string | null>(null);
  /** True once someone has edited this page after it was submitted — including the reviewer, in place (R.4). */
  const [editedSince, setEditedSince] = useState<boolean | null>(null);
  const [templateTitle, setTemplateTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(build.id)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          provenance?: ProvenanceView | null;
          templateHasMovedOn?: boolean | null;
          comparedAgainst?: 'as-handed' | 'template-now';
          digest?: { sentence?: string } | null;
          editedSinceSubmission?: boolean | null;
          submission?: { templateTitle?: string | null };
        };
        if (cancelled || !res.ok) return;
        setProv(json.provenance ?? null);
        setTemplateMoved(json.templateHasMovedOn ?? null);
        setComparedAgainst(json.comparedAgainst ?? null);
        setDigest(json.digest?.sentence?.trim() || null);
        setEditedSince(json.editedSinceSubmission ?? null);
        setTemplateTitle(json.submission?.templateTitle ?? null);
      } catch {
        // The panel is still useful without it — a failed lookup must not blank the decision controls.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [build.id]);

  const decide = useCallback(
    async (decision: 'approve' | 'reject') => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(build.id)}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ decision, message: note.trim() || undefined }),
        });
        const json = (await res.json()) as { status?: string; error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not record the decision.');
        // Reflected in place rather than refetched: the build is still here, its status just moved.
        setStatus(json.status ?? decision);
        setNote('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not record the decision.');
      } finally {
        setBusy(false);
      }
    },
    [build.id, note]
  );

  /**
   * Downloads come from the stored record, not from the rendered canvas.
   *
   * JSON is the page as saved; HTML is built by the same function the canvas uses minus the editing controls,
   * so what you download is what the page *is* rather than what the editor looked like.
   */
  const download = useCallback(
    async (format: 'json' | 'html') => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(build.id)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as { pattern?: Record<string, unknown>; error?: string };
        if (!res.ok || !json.pattern) throw new Error(json.error || 'Could not load the page.');

        let blob: Blob;
        if (format === 'json') {
          blob = new Blob([JSON.stringify(json.pattern, null, 2)], { type: 'application/json' });
        } else {
          const { constructComponentPreview } = await import('../Playground/Preview');
          const { hydrateForExport } = await import('./export-blocks');
          const hydrated = await hydrateForExport(json.pattern, basePath);
          const html = await constructComponentPreview(hydrated, basePath, { injectBlockControls: false });
          blob = new Blob([html], { type: 'text/html' });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${build.id}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not prepare the download.');
      } finally {
        setBusy(false);
      }
    },
    [build.id, basePath]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5" onClick={onBackToBrief}>
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs">{backLabel}</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold leading-snug">{build.title || build.id}</h2>
          <p className="text-xs text-muted-foreground">
            {/* Unverified, and says so — the guest session cannot vouch for who this is. */}
            Made by <strong>{build.submittedByName ?? 'someone'}</strong> <span>(self-declared)</span>
            {build.submittedAt ? ` · ${new Date(build.submittedAt).toLocaleString()}` : ''}
          </p>
          {/**
            * The lifecycle vocabulary already has labels and a `ghost` presentation flag — printing the raw enum
            * ("Status: review") ignored a designed vocabulary and leaked an implementation value into the UI.
            */}
          <p className="text-xs">
            <span
              className={
                status === 'approved'
                  ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400'
                  : status === 'review'
                    ? 'rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400'
                    : 'rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'
              }
            >
              {LIFECYCLE_META[status as keyof typeof LIFECYCLE_META]?.label ?? status}
            </span>
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : null}

        {/**
          * Where this came from — read-only, never editable (reflow R.4).
          *
          * Above the decision because it *is* context for it: a reviewer asking "should this ship" needs to know
          * what this person was handed, when, and whether the template has moved since. This is the visible half
          * of the fork copy that replaced briefs, and the reason keeping that copy is worth the storage.
          */}
        {prov ? (
          <section className="space-y-1.5 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where this came from</p>
            {/**
              * What changed, before the details of what changed. A reviewer deciding *whether to look* is asking
              * a different question from one deciding about a specific field, and the field list only answers
              * the second (reflow R.6b).
              */}
            {digest ? <p className="text-sm text-foreground">{digest}</p> : null}
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Template</dt>
                <dd className="truncate text-right text-foreground">{templateTitle || prov.templateId || 'Unknown'}</dd>
              </div>
              {prov.forkedAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Started</dt>
                  <dd className="text-right text-foreground">{new Date(prov.forkedAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {prov.submittedAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd className="text-right text-foreground">{new Date(prov.submittedAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {prov.submittedByEmail ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Contact</dt>
                  {/* Self-asserted, confirmed only by the return link arriving. Never an identity claim. */}
                  <dd className="truncate text-right text-foreground">{prov.submittedByEmail}</dd>
                </div>
              ) : null}
            </dl>

            {/* The two things a live template makes possible, both said plainly rather than left to be inferred. */}
            {templateMoved ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                The template has changed since this was started. The comparison is against what they were
                actually handed.
              </p>
            ) : null}
            {comparedAgainst === 'template-now' ? (
              <p className="text-xs text-muted-foreground">
                No copy of the original was kept for this page, so the comparison is against the template as it
                stands today.
              </p>
            ) : null}
            {prov.legacy ? (
              <p className="text-xs text-muted-foreground">
                Reconstructed from the old invitation record rather than captured at the time.
              </p>
            ) : null}
            {/**
              * Said out loud, because owner-edits-in-place makes the diff mean something slightly different
              * (R.4): it is "changes since the template", not "changes this person made". Without this line a
              * reviewer would read their own edits as the author's.
              */}
            {editedSince ? (
              <p className="text-xs text-muted-foreground">
                This page has been edited since it was submitted, so the comparison includes those changes as
                well as the author’s.
              </p>
            ) : null}
            {prov.findingsAtSubmit.length ? (
              <p className="text-xs text-muted-foreground">
                {prov.findingsAtSubmit.length} advisory finding
                {prov.findingsAtSubmit.length === 1 ? '' : 's'} stood when they submitted.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Their note</p>
          {build.submittedMessage ? (
            <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
              “{build.submittedMessage}”
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">They left no note.</p>
          )}
        </section>

        {/**
          * The decision sits **above** the diagnostics, not below them.
          *
          * A reviewer's job is to look at the page and decide. This was the last section in a 300px scrolling rail,
          * so on any build with findings the primary action was off-screen — the reviewer had to scroll past every
          * check to reach the two buttons they came for. Diagnostics inform the decision; they should not stand in
          * front of it.
          */}
        <section className="space-y-2 border-t pt-4">
          <label htmlFor="verdict-note" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Note to the author <span className="font-normal normal-case">(optional)</span>
          </label>
          <Textarea id="verdict-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          {status === 'review' ? (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void decide('approve')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void decide('reject')}>
                Send back
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only a build awaiting review can be decided. This one is {status}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Approving doesn’t change who can see it — visibility stays separate.
          </p>
        </section>

        {/**
          * **One list, not two sections and four headings** (Brad, 2026-08-11: *"merge the two findings sections"*).
          *
          * The split into "Checks" (audits) and "Content rules" (advisory guardrails) was justified at the *data*
          * layer — different passes, different vocabularies — and that argument does not transfer to the UI. A
          * reviewer asking "what is wrong with this page?" does not care which pass noticed. The category is not
          * lost: it moves onto the row it describes, so five findings read as five lines instead of two sections,
          * four headings and five lines.
          *
          * Ordered by `FindingsList`: blocking first, then by block position, so it reads down the page.
          */}
        <section className="space-y-3 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Checks{allFindings.length ? ` (${allFindings.length})` : ''}
          </p>
          <FindingsList
            findings={allFindings}
            emptyNote="No issues found."
            onSelect={requestFieldReveal}
          />
          {/**
            * The honest empty-state from E.10, now with the thing that fills it. Until this is run, "No issues
            * found" would still be claiming more than we checked.
            */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={voiceBusy} onClick={() => void runVoiceCheck()}>
              {voiceBusy ? 'Checking voice…' : 'Check voice'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {voiceNote ?? (voiceFindings.length ? `${voiceFindings.length} in the list above.` : VOICE_NOT_CHECKED)}
            </span>
          </div>
        </section>

        <section className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Download</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void download('json')}>
              JSON
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void download('html')}>
              HTML
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">PDF is coming.</p>
        </section>

        {/**
          * The conversation, last. A reviewer came here to look and decide; the thread is what happens when the
          * answer is "not yet". The page's author sees the same thread through their return link.
          */}
        <section className="border-t pt-4">
          <PageNotes pageId={build.id} canResolve />
        </section>
      </div>
    </div>
  );
}
