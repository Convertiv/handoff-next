import 'server-only';

import { after } from 'next/server';
import { runComponentGenerationJob } from '@/lib/server/component-generation-run';

export function scheduleComponentGenerationJob(jobId: number): void {
  after(() => {
    void runComponentGenerationJob(jobId).catch((err) => {
      console.error('[component-generation-schedule] job failed', jobId, err);
    });
  });
}
