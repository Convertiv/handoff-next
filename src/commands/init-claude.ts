import { CommandModule } from 'yargs';
import path from 'path';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';
import { Logger } from '@handoff/utils/logger';
import { resolveSyncRemoteUrl, getSyncBearerToken } from '@handoff/cli/sync/sync-remote-env';
import { writeMcpProjectFiles } from '@handoff/cli/init-claude-core';

export interface InitClaudeArgs extends SharedArgs {
  root?: string;
  serverName?: string;
  tokenEnv?: string;
}

const command: CommandModule<{}, InitClaudeArgs> = {
  command: 'init-claude',
  describe:
    'Wire a project to its Handoff design system for Claude/agents: fetch DESIGN.md from the ' +
    'registry, register the MCP server in .mcp.json, and add a Design System section to CLAUDE.md.',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('root', { type: 'string', describe: 'Project root to write into (default: cwd).' })
      .option('server-name', { type: 'string', default: 'handoff', describe: 'MCP server name in .mcp.json.' })
      .option('token-env', {
        type: 'string',
        default: 'HANDOFF_MCP_TOKEN',
        describe: 'Env var the MCP config reads the bearer token from (kept out of the committed file).',
      }),
  handler: async (args: InitClaudeArgs) => {
    const root = path.resolve(args.root ?? process.env.HANDOFF_WORKING_PATH ?? process.cwd());
    const serverName = args.serverName ?? 'handoff';
    const tokenEnv = args.tokenEnv ?? 'HANDOFF_MCP_TOKEN';

    try {
      const remoteUrl = await resolveSyncRemoteUrl(root);
      const bearer = await getSyncBearerToken(root);

      const { designMdPath, mcpPath, claudeMdPath, designMdLines } = await writeMcpProjectFiles({
        root,
        serverName,
        tokenEnv,
        remoteUrl,
        bearer,
      });
      Logger.success(`Wrote ${designMdPath} (${designMdLines} lines)`);
      Logger.success(`Updated ${mcpPath} (server: ${serverName})`);
      Logger.success(`Updated ${claudeMdPath}`);

      Logger.info('');
      Logger.info(`Set ${tokenEnv} to your registry token so the MCP server can authenticate:`);
      Logger.info(`  export ${tokenEnv}=$(handoff-app mcp-token)`);
      Logger.info('  (your token lives in .handoff/cli-auth.json — do not commit it)');
      process.exit(0);
    } catch (e) {
      Logger.error(`init-claude failed: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};

export default command;
