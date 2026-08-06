'use client';

import { useMemo, useRef } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { handoffApiUrl } from '@/lib/api-path';
import { buildPatternPayload } from '@/lib/pattern-payload';
import PlaygroundBuilder from '@/components/Playground/PlaygroundBuilder';
import { PlaygroundProvider, type PlaygroundPersistence } from '@/components/Playground/PlaygroundContext';
import type { PatternComponentEntry } from '@/lib/guest-editable';
import type { GuardrailConfig } from '@/lib/authoring-guardrails';

/**
 * A guest editing their page **in the real editor** (roadmap E.5).
 *
 * Replaces the hand-rolled list of form fields that had no preview. The whole point: one editor, so every
 * improvement to block editing reaches guests, and a guest sees the page they are actually making.
 *
 * What makes a guest different is only two things, both injected rather than forked:
 * - **persistence** — the guest endpoints instead of the authenticated ones (no session, a signed cookie);
 * - **`structuralEditing: false`** — content is editable, structure is not. No add, no drag, no delete.
 *
 * `aiAssistantEnabled: false` because every AI endpoint requires a session; offering the control would be an
 * invitation to a 401. Guardrails need no wiring at all — the Slice 3 engine reads the canvas.
 */

interface Props {
  /** Public link id. The secret was exchanged for a cookie at `/enter` and is never used again. */
  linkId: string;
}

export default function GuestEditor({ linkId }: Props) {
  /**
   * The submission id, learned at hydrate and reused when saving.
   *
   * The server takes the id from the signed cookie, so this is only needed to keep the stored payload
   * self-consistent (`buildPatternPayload` stamps an id inside `data`). Held in a ref because changing it must
   * not re-create the adapter and re-trigger a load.
   */
  const submissionId = useRef<string>('');

  const persistence = useMemo<PlaygroundPersistence>(
    () => ({
      hydrate: async () => {
        const res = await fetch(handoffApiUrl(`/api/handoff/guest/submission?link=${encodeURIComponent(linkId)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          submission?: { id: string; components?: unknown; data?: unknown } | null;
          guardrails?: GuardrailConfig;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || 'Could not load this page.');
        if (!json.submission) return null;

        submissionId.current = json.submission.id;
        const components = (Array.isArray(json.submission.components) ? json.submission.components : []) as PatternComponentEntry[];
        const data = (json.submission.data ?? {}) as { previews?: { default?: { values?: unknown } } };
        const values = Array.isArray(data.previews?.default?.values)
          ? (data.previews!.default!.values as Record<string, unknown>[])
          : [];
        // The endpoint resolves guardrails from the brief; carrying them here is what lets the field editor
        // show the same limits the submit check enforces.
        return { components, values, guardrails: json.guardrails };
      },

      persist: async (blocks) => {
        const { components, payload } = buildPatternPayload(
          submissionId.current || 'submission',
          '',
          '',
          '',
          [],
          blocks,
          ''
        );
        const res = await fetch(handoffApiUrl(`/api/handoff/guest/submission?link=${encodeURIComponent(linkId)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ components, data: payload }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          // Thrown so the editor's own save indicator shows "Not saved" — the canvas keeps the work.
          throw new Error(json.error || 'Could not save.');
        }
      },
    }),
    [linkId]
  );

  return (
    <TooltipProvider>
      <PlaygroundProvider persistence={persistence} structuralEditing={false} aiAssistantEnabled={false}>
        <PlaygroundBuilder />
      </PlaygroundProvider>
    </TooltipProvider>
  );
}
