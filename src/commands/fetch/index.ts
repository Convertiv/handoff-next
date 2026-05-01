import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface FetchArgs extends SharedArgs {}

const command: CommandModule<{}, FetchArgs> = {
  command: 'fetch',
  describe: 'Fetch the design tokens',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: FetchArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.fetch();
  },
};

export default command;
