import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runCliLogin } from '@handoff/cli/sync/run-cli-login';
import { getSyncRemoteUrlOptional } from '@handoff/cli/sync/sync-remote-env';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';

export interface LoginArgs extends SharedArgs {
  url?: string;
  /** Open verification URL in the system browser (default true; use --no-browser to skip). */
  browser?: boolean;
}

const command: CommandModule<{}, LoginArgs> = {
  command: 'login',
  describe: 'OAuth device flow: sign in via browser and save CLI sync credentials to .handoff/cli-auth.json',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('url', {
        type: 'string',
        describe: 'Handoff deployment origin (e.g. https://docs.example.com or https://example.com/docs). Uses HANDOFF_CLOUD_URL if omitted.',
      })
      .option('browser', {
        type: 'boolean',
        default: true,
        describe: 'Open the verification URL in the system default browser (off with --no-browser; also skipped when CI=1 or HANDOFF_LOGIN_NO_BROWSER=1).',
      }),
  handler: async (args: LoginArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    const url = args.url?.trim() || getSyncRemoteUrlOptional();
    if (!url) {
      throw new Error('Pass --url <https://your-handoff> or set HANDOFF_CLOUD_URL first.');
    }
    await runCliLogin(handoff, url, { openBrowser: args.browser !== false });
  },
};

export default command;
