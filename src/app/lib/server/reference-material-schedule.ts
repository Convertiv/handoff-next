import 'server-only';

import { after } from 'next/server';
import { regenerateAllReferenceMaterialsPersisted } from '@/lib/server/reference-material-persist';

/** Fire-and-forget regeneration after user-facing events (Figma fetch, component create). */
export function scheduleReferenceMaterialsRegenerate(opts?: { actorUserId?: string | null; skipLlm?: boolean }): void {
  after(() => {
    void regenerateAllReferenceMaterialsPersisted(opts ?? {}).catch((err) => {
      console.error('[reference-material-schedule] regenerate failed', err);
    });
  });
}
