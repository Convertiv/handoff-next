import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPull } from '@handoff/cli/sync/run-pull';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PullArgs extends SharedArgs {
  dryRun?: boolean;
}

const command: CommandModule<{}, PullArgs> = {
  command: 'pull',
  describe:
    'Pull remote Handoff edits into local pages and *.handoff.json (requires HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN, or legacy HANDOFF_SYNC_URL + HANDOFF_SYNC_SECRET)',
  builder: (yargs) =>
    getSharedOptions(yargs).option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Fetch remote changes and show what would be written without modifying files or sync state.',
    }),
  handler: async (args: PullArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runPull(handoff, { dryRun: Boolean(args.dryRun) });
  },
};

export default command;
