import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface StartArgs extends SharedArgs {}

const command: CommandModule<{}, StartArgs> = {
  command: 'start',
  describe: 'Start the design system in development mode',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: StartArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.start();
  },
};

export default command;
