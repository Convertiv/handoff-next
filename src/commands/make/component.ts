import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface MakeComponentArgs extends SharedArgs {
  name: string;
}

const command: CommandModule<{}, MakeComponentArgs> = {
  command: 'make:component <name>',
  describe: 'Create a new html code component that you can embed in your documentation',
  builder: (yargs) => {
    return getSharedOptions(yargs).positional('name', {
      describe: 'The name of the new component you are creating',
      type: 'string',
    });
  },

  handler: async (args: MakeComponentArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    const componentName = args.name;

    if (!/^[a-z0-9_-]+$/i.test(componentName)) {
      Logger.error(`Component name must be alphanumeric and may contain dashes or underscores`);
      return;
    }

    await handoff.makeComponent(componentName);
  },
};

export default command;
