import 'dotenv/config';
import Handoff from '@handoff/index';
import buildApp from '@handoff/app-builder/index';
import { Logger } from '@handoff/utils/logger';
import { figmaExtract, validateFigmaAuth } from './figma.js';
import { buildCustomFonts, buildStyles } from './styles.js';
import { validateHandoffRequirements } from './validation.js';

// Re-exports used by other modules
export { readPrevJSONFile, zip, zipAssets } from './archive.js';
export { buildComponents } from './components.js';
export { buildPatterns } from './patterns.js';

/**
 * Run the entire Figma data pipeline:
 * 1. Validate runtime requirements
 * 2. Validate/prompt for Figma auth
 * 3. Extract data from Figma
 * 4. Build custom fonts
 * 5. Build design token styles
 * 6. Optionally build the documentation app
 */
const pipeline = async (handoff: Handoff, build?: boolean) => {
  if (!handoff.config) {
    throw new Error('Handoff config not found');
  }
  Logger.success(`Starting Handoff Figma data pipeline. Checking for environment and config.`);
  await validateHandoffRequirements();
  await validateFigmaAuth(handoff);
  const documentationObject = await figmaExtract(handoff);
  await buildCustomFonts(handoff, documentationObject);
  await buildStyles(handoff, documentationObject);
  // await buildComponents(handoff);
  if (build) {
    await buildApp(handoff);
  }
};

export default pipeline;
