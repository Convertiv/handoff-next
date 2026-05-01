import Handoff from '@handoff/index';
import { componentTransformer } from '@handoff/transformers/preview/component';

/**
 * Builds component previews by running the component transformer.
 */
export const buildComponents = async (handoff: Handoff) => {
  await Promise.all([componentTransformer(handoff)]);
};
