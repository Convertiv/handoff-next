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
    await handoff.build(args.skipComponents ?? false, 'vercel');
    const appPath = getEphemeralRuntimePath(handoff);
    runNextProductionBuild(handoff, appPath);
  },
};

export default command;
