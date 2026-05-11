import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runSyncStatus } from '@handoff/cli/sync/run-sync-status';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface SyncStatusArgs extends SharedArgs {}

const command: CommandModule<{}, SyncStatusArgs> = {
  command: 'sync-status',
  describe:
    'Show remote sync cursor vs local .handoff/sync-state.json (same HANDOFF_CLOUD_* / legacy HANDOFF_SYNC_* env vars as push and pull)',
  builder: (yargs) => getSharedOptions(yargs),
  handler: async (args: SyncStatusArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runSyncStatus(handoff);
  },
};

export default command;
