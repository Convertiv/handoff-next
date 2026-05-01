import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface EjectPagesArgs extends SharedArgs {}

const command: CommandModule<{}, EjectPagesArgs> = {
  command: 'eject:pages',
  describe: 'Eject the default pages to the current working directory',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: EjectPagesArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.ejectPages();
  },
};

export default command;
