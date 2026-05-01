import { Argv, CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface PrepareRuntimeArgs extends SharedArgs {
  skipComponents?: boolean;
}

const command: CommandModule<{}, PrepareRuntimeArgs> = {
  command: 'prepare-runtime',
  describe: 'Materialize the Next.js Handoff app to .handoff/runtime (for CI/Vercel; does not run next build)',
  builder: (yargs): Argv<PrepareRuntimeArgs> =>
    getSharedOptions(yargs).option('skip-components', {
      describe: 'Skip building components before preparing the runtime',
      type: 'boolean',
      default: false,
    }) as Argv<PrepareRuntimeArgs>,
  handler: async (args: PrepareRuntimeArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.build(args.skipComponents ?? false, 'vercel');
  },
};

export default command;
