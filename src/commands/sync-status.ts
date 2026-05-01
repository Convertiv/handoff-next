import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runSyncStatus } from '@handoff/cli/sync/run-sync-status';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface SyncStatusArgs extends SharedArgs {}

const command: CommandModule<{}, SyncStatusArgs> = {
  command: 'sync-status',
  describe: 'Show remote sync cursor vs local .handoff/sync-state.json (requires HANDOFF_SYNC_URL + HANDOFF_SYNC_SECRET)',
  builder: (yargs) => getSharedOptions(yargs),
  handler: async (args: SyncStatusArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runSyncStatus(handoff);
  },
};

export default command;
