import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPush } from '@handoff/cli/sync/run-push';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushArgs extends SharedArgs {}

const command: CommandModule<{}, PushArgs> = {
  command: 'push',
  describe: 'Push local pages and *.handoff.json declarations to remote Handoff (requires HANDOFF_SYNC_URL + HANDOFF_SYNC_SECRET)',
  builder: (yargs) => getSharedOptions(yargs),
  handler: async (args: PushArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runPush(handoff);
  },
};

export default command;
