import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { clearCliAuth } from '@handoff/cli/sync/cli-auth-store.js';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface LogoutArgs extends SharedArgs {}

const command: CommandModule<{}, LogoutArgs> = {
  command: 'logout',
  describe: 'Remove saved CLI sync credentials (.handoff/cli-auth.json) for this project',
  builder: (yargs) => getSharedOptions(yargs),
  handler: async (args: LogoutArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await clearCliAuth(handoff.workingPath);
    const { Logger } = await import('@handoff/utils/logger');
    Logger.success('Removed .handoff/cli-auth.json (if it existed).');
  },
};

export default command;
