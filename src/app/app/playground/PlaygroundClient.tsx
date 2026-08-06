'use client';

import Layout from '../../components/Layout/Main';
import { PlaygroundProvider } from '../../components/Playground/PlaygroundContext';
import PlaygroundBuilder from '../../components/Playground/PlaygroundBuilder';
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
}: {
  menu: unknown;
  metadata: unknown;
  current: unknown;
  config: unknown;
  initialPatternId?: string;
  initialIsTemplate?: boolean;
  pageTitle?: string;
  initialBriefs?: React.ComponentProps<typeof PlaygroundProvider>['initialBriefs'];
}) {
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <TooltipProvider>
        <PlaygroundProvider
          initialPatternId={initialPatternId}
          initialIsTemplate={initialIsTemplate}
          pageTitle={pageTitle}
          initialBriefs={initialBriefs}
        >
          <PlaygroundBuilder />
        </PlaygroundProvider>
      </TooltipProvider>
    </Layout>
  );
}
