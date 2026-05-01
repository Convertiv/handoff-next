import Handoff from '@handoff/index';
import { buildPatterns } from '@handoff/pipeline/patterns';
import processComponents, { ComponentSegment } from '@handoff/transformers/preview/component/builder';
import { getPatternIdsReferencingComponents } from '@handoff/transformers/preview/pattern/builder';
import { Logger } from '@handoff/utils/logger';
import { diffMapSnapshots, MapSnapshot, stableStringify } from '@handoff/app-builder/config-diff/snapshot';
import { ConfigDiffStrategy, FinalizeContext } from '@handoff/app-builder/config-diff/types';

/**
 * Snapshots every __pattern_{patternId}_* synthetic preview entry across all
 * components. Outer key is component id, inner key is synthetic preview key.
 */
const snapshotPatternSynthetics = (handoff: Handoff, patternId: string): MapSnapshot => {
  const components = handoff.runtimeConfig?.entries?.components ?? {};
  const prefix = `__pattern_${patternId}_`;
  const result: MapSnapshot = new Map();

  for (const [componentId, component] of Object.entries(components)) {
    const previews = component.internalPatternPreviews ?? {};
    const entries = new Map<string, string>();
    for (const [key, preview] of Object.entries(previews)) {
      if (key.startsWith(prefix)) {
        entries.set(key, stableStringify(preview.values));
      }
    }
    if (entries.size > 0) {
      result.set(componentId, entries);
    }
  }

  return result;
};

export const patternDiffStrategy: ConfigDiffStrategy = {
  kind: 'pattern',

  capture(handoff, entityId) {
    const oldSnapshot = snapshotPatternSynthetics(handoff, entityId);

    return {
      async apply(handoff, entityIdAfterReload) {
        const newSnapshot = entityIdAfterReload
          ? snapshotPatternSynthetics(handoff, entityIdAfterReload)
          : new Map();

        const affectedIds = diffMapSnapshots(oldSnapshot, newSnapshot);
        const displayId = entityIdAfterReload || entityId;

        if (affectedIds.length > 0) {
          Logger.debug(
            `Pattern "${displayId}" changed: rebuilding ${affectedIds.length} affected component(s): ${affectedIds.join(', ')}`
          );
          for (const componentId of affectedIds) {
            await processComponents(handoff, componentId, ComponentSegment.Previews);
          }
        } else {
          Logger.debug(`Pattern "${displayId}" changed: no synthetic previews affected, skipping component rebuild.`);
        }
      },
    };
  },

  async finalize(handoff, context?: FinalizeContext) {
    if (context?.skipPatternFinalizer) {
      return;
    }

    const componentIds = context?.patternRebuildComponentIds;
    if (componentIds?.length) {
      const patternIds = getPatternIdsReferencingComponents(handoff, componentIds);
      if (patternIds.length === 0) {
        return;
      }
      await buildPatterns(handoff, { onlyPatternIds: new Set(patternIds) });
      return;
    }

    await buildPatterns(handoff);
  },
};
