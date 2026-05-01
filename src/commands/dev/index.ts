import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface DevArgs extends SharedArgs {}

const command: CommandModule<{}, DevArgs> = {
  command: 'dev',
  describe: 'Start the design system in development mode',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: DevArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.dev();
  },
};

export default command;
