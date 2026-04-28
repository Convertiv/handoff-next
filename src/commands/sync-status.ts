import { CommandModule } from 'yargs';
import Handoff from '../index';
import { runSyncStatus } from '../cli/sync/run-sync-status';
import { SharedArgs } from './types';
import { getSharedOptions } from './utils';

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
