import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface EjectConfigArgs extends SharedArgs {}

const command: CommandModule<{}, EjectConfigArgs> = {
  command: 'eject:config',
  describe: 'Eject the default configuration to the current working directory',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: EjectConfigArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.ejectConfig();
  },
};

export default command;
