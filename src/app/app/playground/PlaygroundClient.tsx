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
}: {
  menu: unknown;
  metadata: unknown;
  current: unknown;
  config: unknown;
  initialPatternId?: string;
  initialIsTemplate?: boolean;
}) {
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <TooltipProvider>
        <PlaygroundProvider initialPatternId={initialPatternId} initialIsTemplate={initialIsTemplate}>
          <PlaygroundBuilder />
        </PlaygroundProvider>
      </TooltipProvider>
    </Layout>
  );
}
