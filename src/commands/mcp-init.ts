import { CommandModule } from 'yargs';
import path from 'path';
import fs from 'fs-extra';
import Handoff from '@handoff/index';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';
import { Logger } from '@handoff/utils/logger';
import { resolveSyncRemoteUrl, getSyncBearerToken, getSyncRemoteUrlOptional } from '@handoff/cli/sync/sync-remote-env';
import { runCliLogin } from '@handoff/cli/sync/run-cli-login';
import { writeMcpProjectFiles } from '@handoff/cli/init-claude-core';

export interface McpInitArgs extends SharedArgs {
  url?: string;
  root?: string;
  serverName?: string;
  tokenEnv?: string;
  embed?: boolean;
  browser?: boolean;
}

/** Ensure `entry` is present in the project .gitignore. Returns true if added. */
async function ensureGitignore(root: string, entry: string): Promise<boolean> {
  const gi = path.join(root, '.gitignore');
  const content = (await fs.pathExists(gi)) ? await fs.readFile(gi, 'utf-8') : '';
  if (content.split('\n').some((l) => l.trim() === entry)) return false;
  await fs.writeFile(gi, `${content.replace(/\s*$/, '')}\n${entry}\n`, 'utf-8');
  return true;
}

const command: CommandModule<{}, McpInitArgs> = {
  command: 'mcp-init',
  describe:
    'One-step MCP onboarding: sign in (browser round-trip if needed), then wire this project to its ' +
    'Handoff design system — .mcp.json + DESIGN.md + CLAUDE.md. Use --embed to write the token into ' +
    '.mcp.json (gitignored) instead of an env reference.',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('url', { type: 'string', describe: 'Registry URL (default: HANDOFF_CLOUD_URL / project config).' })
      .option('root', { type: 'string', describe: 'Project root to write into (default: cwd).' })
      .option('server-name', { type: 'string', default: 'handoff', describe: 'MCP server name in .mcp.json.' })
      .option('token-env', {
        type: 'string',
        default: 'HANDOFF_MCP_TOKEN',
        describe: 'Env var the MCP config reads the token from (default; ignored with --embed).',
      })
      .option('embed', {
        type: 'boolean',
        default: false,
        describe: 'Embed the literal token in .mcp.json (auto-gitignored) instead of an env reference.',
      })
      .option('browser', {
        type: 'boolean',
        default: true,
        describe: 'Open the browser for the login round-trip (use --no-browser for headless).',
      }),
  handler: async (args: McpInitArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    const root = path.resolve(args.root ?? process.env.HANDOFF_WORKING_PATH ?? process.cwd());
    const serverName = args.serverName ?? 'handoff';
    const tokenEnv = args.tokenEnv ?? 'HANDOFF_MCP_TOKEN';

    try {
      const url =
        args.url?.trim() || getSyncRemoteUrlOptional() || (await resolveSyncRemoteUrl(root).catch(() => ''));
      if (!url) {
        throw new Error('Pass --url <https://your-handoff> or set HANDOFF_CLOUD_URL first.');
      }

      // 1. Ensure authenticated — kick off the login round-trip if needed.
      let bearer: string;
      try {
        bearer = await getSyncBearerToken(root);
      } catch {
        Logger.info('Not signed in for this registry — starting login…');
        await runCliLogin(handoff, url, { openBrowser: args.browser !== false });
        bearer = await getSyncBearerToken(root);
      }

      // 2. Write project files (embed token if requested).
      const { designMdPath, mcpPath, claudeMdPath, designMdLines } = await writeMcpProjectFiles({
        root,
        serverName,
        tokenEnv,
        remoteUrl: url,
        bearer,
        embedToken: args.embed ? bearer : undefined,
      });
      Logger.success(`Wrote ${designMdPath} (${designMdLines} lines)`);
      Logger.success(`Updated ${mcpPath} (server: ${serverName})`);
      Logger.success(`Updated ${claudeMdPath}`);

      // 3. Token guidance.
      if (args.embed) {
        const added = await ensureGitignore(root, '.mcp.json');
        Logger.warn('Embedded your token in .mcp.json — do NOT commit it.');
        Logger.info(added ? 'Added .mcp.json to .gitignore.' : 'Confirm .mcp.json is gitignored.');
      } else {
        Logger.info('');
        Logger.info('Set the MCP token before starting your editor:');
        Logger.info(`  export ${tokenEnv}=$(handoff-app mcp-token)`);
      }
      Logger.success('MCP ready — restart Cursor/Claude to pick up .mcp.json.');
      process.exit(0);
    } catch (e) {
      Logger.error(`mcp-init failed: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};

export default command;
