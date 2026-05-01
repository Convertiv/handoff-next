import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface BuildAppArgs extends SharedArgs {
  skipComponents?: boolean;
  mode?: 'dynamic' | 'vercel';
}

const command: CommandModule<{}, BuildAppArgs> = {
  command: 'build:app',
  describe: 'Build the documentation application',
  builder: (yargs) => {
    return getSharedOptions(yargs).option('skip-components', {
      describe: 'Skip building components before building the app',
      type: 'boolean',
      default: false,
    }).option('mode', {
      describe: 'Build mode',
      choices: ['dynamic', 'vercel'] as const,
      default: 'dynamic',
    });
    return getSharedOptions(yargs);
  },
  handler: async (args: BuildAppArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.build(args.skipComponents ?? false, args.mode ?? 'dynamic');
  },
};

export default command;
