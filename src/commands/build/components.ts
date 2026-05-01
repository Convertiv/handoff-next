import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface BuildComponentsArgs extends SharedArgs {
  component?: string;
}

const command: CommandModule<{}, BuildComponentsArgs> = {
  command: 'build:components [component]',
  describe: 'Build the current project components. Pass a name to build a specific component.',
  builder: (yargs) => {
    return getSharedOptions(yargs).positional('component', {
      describe: 'The name of the component',
      type: 'string',
    });
  },
  handler: async (args: BuildComponentsArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    await handoff.component(args.component);
  },
};

export default command;
