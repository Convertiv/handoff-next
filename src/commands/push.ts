import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runPush } from '@handoff/cli/sync/run-push';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface PushArgs extends SharedArgs {
  components?: string[];
  patterns?: string[];
  pages?: string[];
  dryRun?: boolean;
  build?: boolean;
  metadataOnly?: boolean;
  noBuild?: boolean;
}

const command: CommandModule<{}, PushArgs> = {
  command: 'push',
  describe:
    'Push local pages, component/pattern declarations (.handoff.ts/.js/.json), and built preview artifacts to remote Handoff (requires HANDOFF_CLOUD_URL + token or handoff-app login)',
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
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'List what would be pushed without calling the remote API (no cloud URL/token required).',
      })
      .option('build', {
        type: 'boolean',
        describe: 'Build components/patterns locally before push (default: true when pushing components or patterns).',
      })
      .option('metadata-only', {
        type: 'boolean',
        default: false,
        describe: 'Push declaration metadata only; skip built preview artifacts under public/api/.',
      })
      .option('no-build', {
        type: 'boolean',
        default: false,
        describe: 'Do not run local builds; upload existing artifacts only.',
      }),
  handler: async (args: PushArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    const componentIds = args.components?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    const patternIds = args.patterns?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    const pageSlugs = args.pages?.flatMap((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    try {
      await runPush(handoff, {
        componentIds: componentIds?.length ? componentIds : undefined,
        patternIds: patternIds?.length ? patternIds : undefined,
        pageSlugs: pageSlugs?.length ? pageSlugs : undefined,
        dryRun: Boolean(args.dryRun),
        build: args.build,
        metadataOnly: Boolean(args.metadataOnly),
        noBuild: Boolean(args.noBuild),
      });
      // Force-exit after a successful push. The chromium child process (used for
      // screenshots and validators) can keep the Node event loop alive even after
      // browser.close() — its IPC channel doesn't always drain cleanly on macOS.
      // A CLI tool has no deferred work to wait for at this point.
      process.exit(0);
    } catch (e) {
      process.exit(1);
    }
  },
};

export default command;
