import Handoff from '@handoff/index';
import { ProcessPatternsOptions, processPatterns } from '@handoff/transformers/preview/pattern/builder';

export type { ProcessPatternsOptions };

/**
 * Builds pattern previews by composing pre-built component preview HTML.
 * Must be called AFTER buildComponents.
 */
export const buildPatterns = async (handoff: Handoff, options?: ProcessPatternsOptions) => {
  await processPatterns(handoff, options);
};
