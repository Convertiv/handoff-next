import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPush } from '@handoff/cli/sync/run-push';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushArgs extends SharedArgs {
  components?: string[];
  patterns?: string[];
  pages?: string[];
}

const command: CommandModule<{}, PushArgs> = {
  command: 'push',
  describe:
    'Push local pages and *.handoff.json declarations to remote Handoff (requires HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN, or legacy HANDOFF_SYNC_URL + HANDOFF_SYNC_SECRET)',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('components', {
        type: 'string',
        array: true,
        describe: 'Only push these component ids (repeat flag or space-separated). Omit to include all components when not using selective push.',
      })
      .option('patterns', {
        type: 'string',
        array: true,
        describe: 'Only push these pattern ids (repeat flag or space-separated).',
      })
      .option('pages', {
        type: 'string',
        array: true,
        describe: 'Only push these page slugs (paths under pages/ without .md, e.g. index or guides/colors).',
      }),
  handler: async (args: PushArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    const componentIds = args.components?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    const patternIds = args.patterns?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    const pageSlugs = args.pages?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    await runPush(handoff, {
      componentIds: componentIds?.length ? componentIds : undefined,
      patternIds: patternIds?.length ? patternIds : undefined,
      pageSlugs: pageSlugs?.length ? pageSlugs : undefined,
    });
  },
};

export default command;
