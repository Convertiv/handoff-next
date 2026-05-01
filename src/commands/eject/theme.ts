import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface EjectThemeArgs extends SharedArgs {}

const command: CommandModule<{}, EjectThemeArgs> = {
  command: 'eject:theme',
  describe: 'Eject the currently selected theme',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: EjectThemeArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.ejectTheme();
  },
};

export default command;
