'use client';

import type { GuardrailFinding } from '@/lib/authoring-guardrails';
import Layout from '../../components/Layout/Main';
import { PlaygroundProvider } from '../../components/Playground/PlaygroundContext';
import PlaygroundWorkbench, { type WorkbenchBrief } from '../../components/Playground/PlaygroundWorkbench';
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
  initialBriefs = [],
  brief = null,
  build = null,
  pageBuilds = [],
  audits = [],
  guardrailFindings = [],
}: {
  menu: unknown;
  metadata: unknown;
  current: unknown;
  config: unknown;
  initialPatternId?: string;
  initialIsTemplate?: boolean;
  pageTitle?: string;
  initialBriefs?: React.ComponentProps<typeof PlaygroundProvider>['initialBriefs'];
  /** Resolved and ownership-checked server-side (roadmap E.8). Null at page level. */
  brief?: WorkbenchBrief | null;
  build?: BuildRow | null;
  pageBuilds?: (BuildRow & { briefId: string })[];
  /** Computed server-side for the selected build (roadmap E.10). */
  guardrailFindings?: GuardrailFinding[];
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
          initialBriefs={initialBriefs}
          basePath={basePath}
          brief={brief}
          build={build}
          pageBuilds={pageBuilds}
          audits={audits}
          guardrailFindings={guardrailFindings}
        />
      </TooltipProvider>
    </Layout>
  );
}
