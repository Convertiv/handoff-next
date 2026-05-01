import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runScaffold } from '@handoff/cli/scaffold';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface ScaffoldArgs extends SharedArgs {}

const command: CommandModule<{}, ScaffoldArgs> = {
  command: 'scaffold',
  describe: 'Scaffold component stubs for fetched Figma components',
  builder: (yargs) => {
    return getSharedOptions(yargs);
  },
  handler: async (args: ScaffoldArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await runScaffold(handoff);
  },
};

export default command;

