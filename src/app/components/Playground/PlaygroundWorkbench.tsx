'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '../ui/button';
import { PlaygroundProvider, type PlaygroundPersistence } from './PlaygroundContext';
import PlaygroundBuilder from './PlaygroundBuilder';
import BuildPanel from '../Brief/BuildPanel';
import BuildList from '../Brief/BuildList';
import type { BuildRow } from '../Brief/BuildList';
import { handoffApiUrl } from '@/lib/api-path';
import type { PatternComponentEntry } from '@/lib/guest-editable';
import type { AuditFinding } from '@/lib/build-audits';
import type { GuardrailFinding } from '@/lib/authoring-guardrails';
import { levelFor } from '@/lib/workbench-level';

/**
 * One shell, two levels: page → the pages built from it (roadmap E.8, collapsed by reflow R.4/R.5).
 *
 * The level comes from the URL — `?brief=<id>` and `?build=<id>` on the page's own route — so it is
 * linkable, survives a refresh, and back/forward do the obvious thing. That matters beyond tidiness: the
 * review queue links straight at a build today, and notifications will later.
 *
 * **The provider is keyed on the record being shown, and that is load-bearing.** The page level autosaves. If
 * the canvas swapped to a brief or a build under a live provider, an in-flight autosave could write that
 * content back onto the page — silent data loss. Keying forces a remount, so each level gets a provider whose
 * persistence only ever points at its own record.
 */


/** Treat a repeated param as one value — `?builds=1&builds=2` is a malformed URL, not two requests. */
function one(value: string | null): boolean {
  return Boolean(value && value !== '0' && value !== 'false');
}

export default function PlaygroundWorkbench({
  pageId,
  pageTitle,
  initialIsTemplate = false,
  basePath,
  build = null,
  pageBuilds = [],
  audits = [],
  guardrailFindings = [],
  buildCanEdit = false,
}: {
  pageId?: string;
  pageTitle?: string;
  initialIsTemplate?: boolean;
  basePath: string;
  /** Resolved server-side, and already checked to belong to `brief`. Null unless a build is selected. */
  build?: BuildRow | null;
  /** Every build across every brief of this page, so `?builds=1` needs no fetch. */
  pageBuilds?: (BuildRow & { briefId: string })[];
  /** Audit findings for the selected build, computed server-side. */
  audits?: AuditFinding[];
  /** Advisory guardrail findings for the build being viewed (roadmap E.11). */
  guardrailFindings?: GuardrailFinding[];
  /**
   * May this viewer edit the submitted page in place (reflow R.4)?
   *
   * Computed on the record by `computePermissions`, server-side, so the canvas never offers an affordance the
   * write path would refuse — the failure this project has already hit twice.
   */
  buildCanEdit?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Shared with the server route so "which level" has one definition — see `lib/workbench-level.ts`.
  const level = levelFor(Boolean(build));
  const recordId = build?.id ?? pageId ?? 'new';

  /**
   * **The owner edits a submitted page in place** (Brad, 2026-08-13; reflow open question #3).
   *
   * A build *is* a page under the reflow, so its owner should be able to fix a typo rather than write a note
   * asking someone else to. What makes this cheap is that no new write path is needed: dropping the read-only
   * adapter and passing `initialPatternId` puts the record on the **ordinary authenticated autosave**, whose
   * write core already enforces `assertCanMutatePattern`. The server decides; this only decides what to offer.
   *
   * A brief is never editable this way — it is a frozen legacy record, and `patchPattern` refuses it anyway.
   */
  const editingSubmission = level === 'build' && buildCanEdit;

  const go = useCallback(
    (next: { build?: string | null; builds?: string | null }) => {
      const params = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname, search]
  );

  /**
   * Read-only hydration for a brief or a build, through the same adapter the guest editor uses.
   *
   * `persist` throws rather than no-oping: nothing on these levels should ever write, and a silent no-op would
   * hide a bug that had already reached the point of trying to mutate a frozen brief or someone else's work.
   */
  const persistence = useMemo<PlaygroundPersistence | undefined>(() => {
    // No adapter when the viewer may edit: that is what selects the normal authenticated save path, the same
    // one the page level uses. An adapter here would mean a second way to write one record.
    if (level === 'page' || editingSubmission) return undefined;
    const id = recordId;
    return {
      hydrate: async () => {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(id)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          pattern?: { components?: unknown; data?: unknown };
          error?: string;
        };
        if (!res.ok || !json.pattern) throw new Error(json.error || 'Could not load this page.');
        const components = (Array.isArray(json.pattern.components) ? json.pattern.components : []) as PatternComponentEntry[];
        const data = (json.pattern.data ?? {}) as { previews?: { default?: { values?: unknown } } };
        const values = Array.isArray(data.previews?.default?.values)
          ? (data.previews!.default!.values as Record<string, unknown>[])
          : [];
        return { components, values };
      },
      persist: async () => {
        throw new Error('This view is read-only.');
      },
    };
  }, [level, recordId, editingSubmission]);

  /**
   * At page level the left panel can also show the work coming back, without leaving the page.
   *
   * A query param rather than component state so it survives a refresh and the back button closes it — the
   * same reason the levels themselves live in the URL.
   */
  const showPageBuilds = level === 'page' && one(search.get('builds'));

  const leftPanel =
    level === 'build' && build ? (
      /**
       * A submitted page, opened from the template it came from. Briefs are retired (R.5), so `?build=` is the
       * only way in and the way back is always the template.
       */
      <BuildPanel
        build={build}
        basePath={basePath}
        audits={audits}
        guardrailFindings={guardrailFindings}
        backLabel="Back to template"
        onBackToBrief={() => go({ build: null })}
      />
    ) : showPageBuilds ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Builds ({pageBuilds.length})</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => go({ builds: null })}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Opened directly: every page here descends from this template by its own provenance (R.5). */}
          <BuildList
            builds={pageBuilds}
            onSelect={(id) => {
              const row = pageBuilds.find((b) => b.id === id);
              if (row) go({ build: row.id, builds: null });
            }}
            emptyNote="Nothing has been built from this page yet. Invite someone to build, and their pages appear here."
          />
        </div>
      </div>
    ) : undefined;

  return (
    <PlaygroundProvider
      // See the note above: remount per record, never re-hydrate in place.
      key={`${level}:${recordId}`}
      {...(level === 'page'
        ? { initialPatternId: pageId, initialIsTemplate, pageTitle }
        : /**
           * An editable submission is opened **by id**, exactly as a page is — hydration and autosave both come
           * from the standard path. `pageTitle` is its own title, not the template's, because this record is
           * the thing being edited.
           */
          editingSubmission && build
          ? { initialPatternId: build.id, pageTitle: build.title }
          : {})}
      persistence={persistence}
      structuralEditing={level === 'page' || editingSubmission}
      /**
       * AI stays off on someone else's submission, deliberately.
       *
       * Fixing a typo is what "edit in place" was asked for; turning a generator loose on work a person just
       * submitted for review is a different act, and off is the reversible default until it is actually asked
       * for.
       */
      aiAssistantEnabled={level === 'page'}
    >
      <PlaygroundBuilder
        leftPanel={leftPanel}
        canvasControls={level === 'page' || editingSubmission}
        buildCount={level === 'page' ? pageBuilds.length : 0}
        onShowBuilds={level === 'page' && !showPageBuilds ? () => go({ builds: '1' }) : undefined}
      />
    </PlaygroundProvider>
  );
}
