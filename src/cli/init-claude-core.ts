import path from 'path';
import fs from 'fs-extra';
import { Logger } from '@handoff/utils/logger';
import { fetchDesignMd } from '@handoff/cli/fetch-design-md';

/**
 * Shared core for wiring a project to its Handoff design system (used by both
 * `init-claude` and `mcp-init`): fetch DESIGN.md, register the MCP server in
 * .mcp.json, and upsert the Design System block in CLAUDE.md.
 */

const BLOCK_START = '<!-- handoff:design-system:start -->';
const BLOCK_END = '<!-- handoff:design-system:end -->';

/** Insert or replace the managed design-system block in a CLAUDE.md body. */
export function upsertManagedBlock(existing: string, block: string): string {
  const managed = `${BLOCK_START}\n${block}\n${BLOCK_END}`;
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + managed + existing.slice(end + BLOCK_END.length);
  }
  const sep = existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n` : '';
  return `${sep}${managed}\n`;
}

export function claudeMdBlock(serverName: string, tokenEnv: string, embedded: boolean): string {
  const authLine = embedded
    ? `- **Live lookups:** the \`${serverName}\` MCP server (\`.mcp.json\`) answers on-demand queries` +
      '\n  (resolve a token, fetch a component, find an icon). It is already configured with your token.'
    : `- **Live lookups:** the \`${serverName}\` MCP server (\`.mcp.json\`) answers on-demand queries` +
      `\n  (resolve a token, fetch a component, find an icon). It requires the \`${tokenEnv}\`` +
      '\n  environment variable set to your registry token.';
  return [
    '# Design System',
    '',
    'This project is wired to a **Handoff** design system. When building or editing UI, use the',
    "design system's real tokens, components, and brand voice — never generic defaults.",
    '',
    `- **Reference brief:** see [DESIGN.md](./DESIGN.md) — colors (\`$sass\` / \`--css-vars\`), type`,
    '  scale, spacing/radius/grid, component vocabulary, and brand voice.',
    authLine,
    '',
    'Prefer DESIGN.md and the MCP over guessing. Use real token names and real component ids.',
  ].join('\n');
}

/**
 * Merge the handoff MCP server into an existing/new .mcp.json without clobbering
 * other servers. When `embedToken` is set, the literal bearer token is written
 * (for local, gitignored configs); otherwise a `${tokenEnv}` env reference is
 * used (safe for committed files).
 */
export async function writeMcpJson(
  mcpPath: string,
  serverName: string,
  remoteUrl: string,
  tokenEnv: string,
  embedToken?: string
): Promise<void> {
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
    headers: { Authorization: embedToken ? `Bearer ${embedToken}` : `Bearer \${${tokenEnv}}` },
  };
  await fs.writeJson(mcpPath, doc, { spaces: 2 });
}

export interface WriteMcpProjectFilesOptions {
  root: string;
  serverName: string;
  tokenEnv: string;
  remoteUrl: string;
  bearer: string;
  /** When set, embed the literal token in .mcp.json instead of an env reference. */
  embedToken?: string;
}

/** Fetch DESIGN.md + write .mcp.json + CLAUDE.md. Returns paths written. */
export async function writeMcpProjectFiles(opts: WriteMcpProjectFilesOptions): Promise<{
  designMdPath: string;
  mcpPath: string;
  claudeMdPath: string;
  designMdLines: number;
}> {
  const { root, serverName, tokenEnv, remoteUrl, bearer, embedToken } = opts;

  Logger.info(`Fetching DESIGN.md from ${remoteUrl} …`);
  const designMd = await fetchDesignMd(remoteUrl, bearer);
  const designMdPath = path.join(root, 'DESIGN.md');
  await fs.writeFile(designMdPath, designMd, 'utf-8');

  const mcpPath = path.join(root, '.mcp.json');
  await writeMcpJson(mcpPath, serverName, remoteUrl, tokenEnv, embedToken);

  const claudeMdPath = path.join(root, 'CLAUDE.md');
  const existing = (await fs.pathExists(claudeMdPath)) ? await fs.readFile(claudeMdPath, 'utf-8') : '';
  await fs.writeFile(claudeMdPath, upsertManagedBlock(existing, claudeMdBlock(serverName, tokenEnv, !!embedToken)), 'utf-8');

  return { designMdPath, mcpPath, claudeMdPath, designMdLines: designMd.split('\n').length };
}
