import { Argv, CommandModule } from 'yargs';
import { runNextProductionBuild } from '@handoff/app-builder/index';
import { getEphemeralRuntimePath } from '@handoff/app-builder/paths';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface VercelBuildArgs extends SharedArgs {
  skipComponents?: boolean;
}

const command: CommandModule<{}, VercelBuildArgs> = {
  command: 'vercel-build',
  describe:
    'Run `build:app --mode vercel` then `next build` in `.handoff/runtime` (single command for Vercel; preserves full Handoff pipeline)',
  builder: (yargs): Argv<VercelBuildArgs> =>
    getSharedOptions(yargs).option('skip-components', {
      describe: 'Skip building components before preparing the runtime',
      type: 'boolean',
      default: false,
    }) as Argv<VercelBuildArgs>,
  handler: async (args: VercelBuildArgs) => {
    const handoff = new Handoff(args.debug, args.force);

    // Registry mode (DATABASE_URL present): components are built locally in workspaces
    // and pushed to the registry — building them again during CI is wasteful.
    // Auto-skip unless explicitly overridden with --no-skip-components.
    const isRegistryMode = Boolean(process.env.DATABASE_URL?.trim());
    const skipComponents = args.skipComponents ?? isRegistryMode;

    if (isRegistryMode && skipComponents && !args.skipComponents) {
      console.log('[handoff] Registry mode detected (DATABASE_URL set) — skipping component builds (use --no-skip-components to override).');
    }

    await handoff.build(skipComponents, 'vercel');
    const appPath = getEphemeralRuntimePath(handoff);
    runNextProductionBuild(handoff, appPath);
  },
};

export default command;
