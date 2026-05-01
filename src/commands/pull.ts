import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPull } from '@handoff/cli/sync/run-pull';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PullArgs extends SharedArgs {}

const command: CommandModule<{}, PullArgs> = {
  command: 'pull',
  describe: 'Pull remote Handoff edits into local pages and *.handoff.json (requires HANDOFF_SYNC_URL + HANDOFF_SYNC_SECRET)',
  builder: (yargs) => getSharedOptions(yargs),
  handler: async (args: PullArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runPull(handoff);
  },
};

export default command;
