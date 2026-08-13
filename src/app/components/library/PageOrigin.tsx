'use client';

import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { handoffApiUrl } from '@/lib/api-path';

/**
 * Where this page came from — **on the page itself** (Brad, 2026-08-13: *"I don't see the provenance of pages
 * anywhere when viewing the page"*).
 *
 * The provenance panel shipped in R.4 lives in the review surface, which you only reach by opening a page
 * *from its template*. Open the same page from the library — the ordinary way to open a page — and there was
 * nothing at all: no sign it was made by someone else, from something, at some moment. For a page whose whole
 * point is that a stranger made it, that is the one fact the screen was missing.
 *
 * **A chip that opens, not a panel that occupies.** Most pages have no provenance and render nothing here; the
 * ones that do are usually being *edited*, not audited, so the detail sits one click away rather than taking
 * rail space from the work.
 */

interface Origin {
  templateId: string | null;
  forkedAt: string | null;
  submittedAt: string | null;
  submittedByEmail: string | null;
  legacy: boolean;
}

export default function PageOrigin({ pageId, basePath = '' }: { pageId: string; basePath?: string }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [templateTitle, setTemplateTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        /**
         * The page's own record, not the review endpoint.
         *
         * The review endpoint would answer this, and it computes a full diff, the guardrails and the audits to
         * do it — an expensive way to render a chip, on every page open, right after an N+1 was removed from
         * the neighbouring surface.
         */
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(pageId)}`), {
          credentials: 'include',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { pattern?: { provenance?: Origin | null } };
        if (cancelled) return;
        const found = json.pattern?.provenance ?? null;
        setOrigin(found);

        // The template's name, only when there is a template to name. One row, and only for a guest's page.
        if (found?.templateId) {
          const tpl = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(found.templateId)}`), {
            credentials: 'include',
          });
          if (!cancelled && tpl.ok) {
            const tplJson = (await tpl.json()) as { pattern?: { title?: string } };
            setTemplateTitle(tplJson.pattern?.title ?? null);
          }
        }
      } catch {
        // A page with no provenance is the normal case, and a failed lookup should look the same as one:
        // nothing. This control never explains its own absence.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!origin) return null;

  const who = origin.submittedByEmail;
  const when = origin.submittedAt ?? origin.forkedAt;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
          <span className="text-xs">Made from a template</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where this came from</p>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Template</dt>
            <dd className="truncate text-right text-foreground">
              {origin.templateId ? (
                <a className="underline underline-offset-2" href={`${basePath}/playground/${encodeURIComponent(origin.templateId)}`}>
                  {templateTitle || origin.templateId}
                </a>
              ) : (
                'Unknown'
              )}
            </dd>
          </div>
          {who ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Made by</dt>
              {/* Self-asserted, confirmed only by the return link arriving. Never an identity claim. */}
              <dd className="truncate text-right text-foreground">{who} (self-declared)</dd>
            </div>
          ) : null}
          {when ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{origin.submittedAt ? 'Submitted' : 'Started'}</dt>
              <dd className="text-right text-foreground">{new Date(when).toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>
        {origin.legacy ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Reconstructed from the old invitation record rather than captured at the time.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
