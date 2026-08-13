'use client';

import { LIFECYCLE_META, type Lifecycle } from '@/lib/authz/vocab';

/**
 * The pages made from a template — one component, mounted in two places (roadmap E.8).
 *
 * Named `BuildList` for now because renaming a file is churn; the *words on screen* are what matter, and
 * "build" is not one of them any more (Brad, 2026-08-13).
 *
 * It appears in the brief panel *and* directly on the page, because being forced through the brief to reach a
 * build was the slow path Brad called out: "so you don't have to go through the brief just to go open the
 * build". Two mount points, one implementation, so the two lists can never drift.
 */

export interface BuildRow {
  id: string;
  title: string;
  status: string;
  submittedByName: string | null;
  submittedAt: string | null;
  submittedMessage: string | null;
  /** Set when the list spans more than one brief, so a row can say which invitation it answers. */
  briefLabel?: string | null;
}

function statusLabel(status: string): string {
  // Falls through to the raw value rather than guessing: a status we do not know is better shown than hidden.
  return (LIFECYCLE_META as Record<string, { short: string } | undefined>)[status]?.short ?? status;
}

export default function BuildList({
  builds,
  selectedId = null,
  onSelect,
  emptyNote = 'Nobody has made a page from this yet. When someone does, it appears here.',
}: {
  builds: BuildRow[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  emptyNote?: string;
}) {
  if (builds.length === 0) {
    // Most invitations sit empty for a while — say so plainly rather than rendering an empty box.
    return <p className="px-1 text-sm text-muted-foreground">{emptyNote}</p>;
  }

  return (
    <ul className="space-y-1">
      {builds.map((build) => {
        const selected = build.id === selectedId;
        return (
          <li key={build.id}>
            <button
              type="button"
              onClick={() => onSelect(build.id)}
              aria-current={selected ? 'true' : undefined}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                selected ? 'bg-muted font-medium' : 'hover:bg-muted/60'
              }`}
            >
              <span className="block truncate">
                {/* Self-declared: the session cannot vouch for who this is, and the brief panel says so. */}
                {build.submittedByName ?? (build.title || build.id)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {build.submittedAt ? new Date(build.submittedAt).toLocaleDateString() : 'no date'}
                {' · '}
                {statusLabel(build.status)}
                {build.briefLabel ? ` · ${build.briefLabel}` : ''}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
