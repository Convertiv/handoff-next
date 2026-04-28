import { CommandModule } from 'yargs';
import Handoff from '../index';
import { runPush } from '../cli/sync/run-push';
import { SharedArgs } from './types';
import { getSharedOptions } from './utils';

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
