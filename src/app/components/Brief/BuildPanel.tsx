'use client';

import { useCallback, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { handoffApiUrl } from '@/lib/api-path';
import type { BuildRow } from './BuildList';
import { groupAuditFindings, type AuditCategory, type AuditFinding } from '@/lib/build-audits';
import { FindingsList } from '../Playground/FindingsList';

/**
 * The left panel at **build level** (roadmap E.8): what the builder said, and what we make of it.
 *
 * Carries over the verdict and download logic from the retired `BriefViewer`, which was a separate route with
 * its own shell. Same actions, same canvas, one interface.
 *
 * The checks section is filled by `build-audits.ts` (roadmap E.10) — computed server-side on the stored record
 * and handed down, so the panel does no work and cannot show a stale result.
 */

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  content: 'Content',
  accessibility: 'Accessibility',
  seo: 'SEO',
  voice: 'Voice',
};

/** Why a category is empty, which is different from it having passed. */
const CATEGORY_EMPTY: Record<AuditCategory, string> = {
  content: 'Nothing flagged.',
  accessibility: 'Nothing flagged.',
  seo: 'Nothing flagged.',
  // Said plainly rather than showing a reassuring tick for a check that does not run yet.
  voice: 'Not checked yet — needs a read against your brand voice.',
};

export default function BuildPanel({
  build,
  basePath,
  audits = [],
  onBackToBrief,
}: {
  build: BuildRow;
  basePath: string;
  audits?: AuditFinding[];
  onBackToBrief: () => void;
}) {
  const grouped = groupAuditFindings(audits);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(build.status);

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
          <span className="text-xs">All builds</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold leading-snug">{build.title || build.id}</h2>
          <p className="text-xs text-muted-foreground">
            {/* Unverified, and says so — the guest session cannot vouch for who this is. */}
            Built by <strong>{build.submittedByName ?? 'someone'}</strong> <span>(self-declared)</span>
            {build.submittedAt ? ` · ${new Date(build.submittedAt).toLocaleString()}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">Status: {status}</p>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
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

        <section className="space-y-3 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Checks{audits.length ? ` (${audits.length})` : ''}
          </p>
          {(Object.keys(CATEGORY_LABEL) as AuditCategory[]).map((category) => {
            const items = grouped[category];
            return (
              <div key={category} className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {CATEGORY_LABEL[category]}
                  {items.length ? (
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                      {items.length}
                    </span>
                  ) : null}
                </p>
                {/**
                  * Shared with the guest's submit failure via `FindingsList` (roadmap E.11), so a finding reads the
                  * same wherever it appears — and the field name is now named rather than left implicit in a path.
                  */}
                <FindingsList findings={items} emptyNote={CATEGORY_EMPTY[category]} />
              </div>
            );
          })}
        </section>

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
      </div>
    </div>
  );
}
