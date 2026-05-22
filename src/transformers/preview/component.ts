import path from 'path';
import Handoff from '@handoff/index';
import { getAPIPath } from './component/api';
import processComponents from './component/builder';
import { buildMainCss } from './component/css';
import { buildMainJS } from './component/javascript';
import writeComponentSummaryAPI from './component/summary';

export * from './slots';

export const getComponentOutputPath = (handoff: Handoff) => path.resolve(getAPIPath(handoff), 'component');

/**
 * Create a component transformer
 */
export async function componentTransformer(handoff: Handoff) {
  const componentData = await processComponents(handoff);
  await writeComponentSummaryAPI(handoff, componentData);
  await buildMainJS(handoff);
  await buildMainCss(handoff);
}
