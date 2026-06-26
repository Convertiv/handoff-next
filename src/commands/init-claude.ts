import { CommandModule } from 'yargs';
import path from 'path';
import fs from 'fs-extra';
import { SharedArgs } from './types.js';
import { getSharedOptions } from './utils.js';
import { Logger } from '@handoff/utils/logger';
import { resolveSyncRemoteUrl, getSyncBearerToken } from '@handoff/cli/sync/sync-remote-env';
import { fetchDesignMd } from '@handoff/cli/fetch-design-md';

export interface InitClaudeArgs extends SharedArgs {
  root?: string;
  serverName?: string;
  tokenEnv?: string;
}

const BLOCK_START = '<!-- handoff:design-system:start -->';
const BLOCK_END = '<!-- handoff:design-system:end -->';

/** Insert or replace the managed design-system block in a CLAUDE.md body. */
function upsertManagedBlock(existing: string, block: string): string {
  const managed = `${BLOCK_START}\n${block}\n${BLOCK_END}`;
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + managed + existing.slice(end + BLOCK_END.length);
  }
  const sep = existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n` : '';
  return `${sep}${managed}\n`;
}

function claudeMdBlock(serverName: string, tokenEnv: string): string {
  return [
    '# Design System',
    '',
    'This project is wired to a **Handoff** design system. When building or editing UI, use the',
    "design system's real tokens, components, and brand voice — never generic defaults.",
    '',
    `- **Reference brief:** see [DESIGN.md](./DESIGN.md) — colors (\`$sass\` / \`--css-vars\`), type`,
    '  scale, spacing/radius/grid, component vocabulary, and brand voice.',
    `- **Live lookups:** the \`${serverName}\` MCP server (\`.mcp.json\`) answers on-demand queries`,
    '  (resolve a token, fetch a component, find an icon). It requires the',
    `  \`${tokenEnv}\` environment variable set to your registry token.`,
    '',
    'Prefer DESIGN.md and the MCP over guessing. Use real token names and real component ids.',
  ].join('\n');
}

/** Merge the handoff MCP server into an existing/new .mcp.json without clobbering other servers. */
async function writeMcpJson(mcpPath: string, serverName: string, remoteUrl: string, tokenEnv: string): Promise<void> {
  let doc: { mcpServers?: Record<string, unknown> } = {};
  if (await fs.pathExists(mcpPath)) {
    try {
      doc = (await fs.readJson(mcpPath)) as typeof doc;
    } catch {
      Logger.warn(`Existing ${mcpPath} is not valid JSON — leaving it untouched and skipping MCP config.`);
      return;
    }
  }
  doc.mcpServers = doc.mcpServers ?? {};
  doc.mcpServers[serverName] = {
    type: 'http',
    url: `${remoteUrl}/api/mcp`,
    headers: { Authorization: `Bearer \${${tokenEnv}}` },
  };
  await fs.writeJson(mcpPath, doc, { spaces: 2 });
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

      Logger.info(`Fetching DESIGN.md from ${remoteUrl} …`);
      const designMd = await fetchDesignMd(remoteUrl, bearer);

      const designMdPath = path.join(root, 'DESIGN.md');
      await fs.writeFile(designMdPath, designMd, 'utf-8');
      Logger.success(`Wrote ${designMdPath} (${designMd.split('\n').length} lines)`);

      const mcpPath = path.join(root, '.mcp.json');
      await writeMcpJson(mcpPath, serverName, remoteUrl, tokenEnv);
      Logger.success(`Updated ${mcpPath} (server: ${serverName})`);

      const claudeMdPath = path.join(root, 'CLAUDE.md');
      const existing = (await fs.pathExists(claudeMdPath)) ? await fs.readFile(claudeMdPath, 'utf-8') : '';
      await fs.writeFile(claudeMdPath, upsertManagedBlock(existing, claudeMdBlock(serverName, tokenEnv)), 'utf-8');
      Logger.success(`Updated ${claudeMdPath}`);

      Logger.info('');
      Logger.info(`Set ${tokenEnv} to your registry token so the MCP server can authenticate.`);
      Logger.info('  (your token lives in .handoff/cli-auth.json — do not commit it)');
      process.exit(0);
    } catch (e) {
      Logger.error(`init-claude failed: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};

export default command;
