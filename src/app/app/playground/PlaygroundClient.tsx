'use client';

import type { GuardrailFinding } from '@/lib/authoring-guardrails';
import Layout from '../../components/Layout/Main';
import { PlaygroundProvider } from '../../components/Playground/PlaygroundContext';
import PlaygroundWorkbench from '../../components/Playground/PlaygroundWorkbench';
import type { BuildRow } from '../../components/Brief/BuildList';
import type { AuditFinding } from '../../lib/build-audits';
import { TooltipProvider } from '../../components/ui/tooltip';

export default function PlaygroundClient({
  menu,
  metadata,
  current,
  config,
  initialPatternId,
  initialIsTemplate = false,
  pageTitle = '',
  build = null,
  pageBuilds = [],
  audits = [],
  guardrailFindings = [],
  buildCanEdit = false,
  newRecordKind,
}: {
  menu: unknown;
  metadata: unknown;
  current: unknown;
  config: unknown;
  initialPatternId?: string;
  initialIsTemplate?: boolean;
  pageTitle?: string;
  /** Resolved and ownership-checked server-side (roadmap E.8). Null at page level. */
  build?: BuildRow | null;
  pageBuilds?: (BuildRow & { briefId: string | null })[];
  /** Computed server-side for the selected build (roadmap E.10). */
  guardrailFindings?: GuardrailFinding[];
  /** Whether this viewer may edit the submitted page in place — computed on the record, server-side. */
  buildCanEdit?: boolean;
  /** `template` when the blank canvas is meant to become one — see the playground route. */
  newRecordKind?: 'template';
  audits?: AuditFinding[];
}) {
  const basePath = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <TooltipProvider>
        {/* The provider moved inside the workbench, which keys it per level — see PlaygroundWorkbench. */}
        <PlaygroundWorkbench
          pageId={initialPatternId}
          pageTitle={pageTitle}
          initialIsTemplate={initialIsTemplate}
          basePath={basePath}
          build={build}
          pageBuilds={pageBuilds}
          audits={audits}
          guardrailFindings={guardrailFindings}
          buildCanEdit={buildCanEdit}
          newRecordKind={newRecordKind}
        />
      </TooltipProvider>
    </Layout>
  );
}
