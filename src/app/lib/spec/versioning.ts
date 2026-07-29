import 'server-only';

import { getSpecVersion, insertSpecVersion } from '@/lib/db/queries';
import { diffSpecs } from '@/lib/spec/diff';
import type { ComponentSpec } from '@/lib/server/design-spec-types';

/**
 * Record a new specification version, diffed against whatever the previous version was.
 *
 * The one place version history is written, so the diff is always computed the same way and against
 * the right baseline. `handoff_design_artifact.component_spec` stays the current-version cache —
 * callers keep updating it exactly as before and additionally call this.
 *
 * Never throws: losing a history entry must not fail the operation that produced the spec. A failure
 * is logged and reported via the return value.
 */
export async function recordSpecVersion(args: {
  artifactId: string;
  spec: ComponentSpec;
  specMd: string | null;
  source: 'generated' | 'edited' | 'imported';
  changeReason?: string | null;
  createdByUserId?: string | null;
}): Promise<{ version: number | null; unchanged: boolean }> {
  try {
    const previous = await getSpecVersion(args.artifactId);
    const previousSpec = (previous?.spec ?? null) as ComponentSpec | null;
    const diff = diffSpecs(previousSpec, args.spec);

    // A regenerate that produces an identical specification should not add a version — otherwise
    // history fills with noise and the changelog stops meaning anything. An explicit edit is
    // recorded regardless, because the user's intent to change something is itself information.
    if (diff.unchanged && previous && args.source === 'generated') {
      return { version: previous.version, unchanged: true };
    }

    const version = await insertSpecVersion({
      artifactId: args.artifactId,
      spec: args.spec,
      specMd: args.specMd,
      source: args.source,
      changeReason: args.changeReason ?? null,
      diff,
      createdByUserId: args.createdByUserId ?? null,
    });
    return { version, unchanged: false };
  } catch (err) {
    console.error('[spec-version] recordSpecVersion failed', args.artifactId, err);
    return { version: null, unchanged: false };
  }
}
