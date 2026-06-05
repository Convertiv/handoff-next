import path from 'path';
import Handoff from '@handoff/index';
import { getAPIPath, getComponentDistPath } from './component/api';
import processComponents from './component/builder';
import { buildMainCss } from './component/css';
import { buildMainJS } from './component/javascript';
import writeComponentSummaryAPI from './component/summary';

export * from './slots';
export { getComponentDistPath } from './component/api';

/**
 * Returns the output path for component build artifacts.
 * - With id: per-component dist directory (components/[id]/dist/)
 * - Without id: shared global artifact directory (public/api/component/) used for main.css, main.js
 */
export const getComponentOutputPath = (handoff: Handoff, id?: string): string =>
  id ? getComponentDistPath(handoff, id) : path.resolve(getAPIPath(handoff), 'component');

/**
 * Create a component transformer
 */
export async function componentTransformer(handoff: Handoff) {
  const componentData = await processComponents(handoff);
  await writeComponentSummaryAPI(handoff, componentData);
  await buildMainJS(handoff);
  await buildMainCss(handoff);
}
