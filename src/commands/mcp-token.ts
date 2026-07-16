import { CommandModule } from 'yargs';
import path from 'path';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';
import { getSyncBearerToken } from '@handoff/cli/sync/sync-remote-env';

export interface McpTokenArgs extends SharedArgs {
  root?: string;
}

const command: CommandModule<{}, McpTokenArgs> = {
  command: 'mcp-token',
  describe:
    'Print this project\'s MCP/sync bearer token (from `handoff-app login`), for pasting into an MCP ' +
    'config or piping into an env var. Prints ONLY the token to stdout.',
  builder: (yargs) =>
    getSharedOptions(yargs).option('root', { type: 'string', describe: 'Project root (default: cwd).' }),
  handler: async (args: McpTokenArgs) => {
    const root = path.resolve(args.root ?? process.env.HANDOFF_WORKING_PATH ?? process.cwd());
    try {
      const token = await getSyncBearerToken(root);
      // stdout is ONLY the token so it composes: export HANDOFF_MCP_TOKEN=$(handoff-app mcp-token)
      process.stdout.write(`${token}\n`);
      process.exit(0);
    } catch (e) {
      process.stderr.write(`mcp-token failed: ${(e as Error).message}\n`);
      process.exit(1);
    }
  },
};

export default command;
