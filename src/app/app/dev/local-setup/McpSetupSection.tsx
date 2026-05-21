'use client';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMemo, useState } from 'react';

const TOKEN_PLACEHOLDER = 'PASTE_ACCESS_TOKEN_FROM_CLI_AUTH';

type Props = {
  /** Hosted Handoff origin (no trailing slash), e.g. https://docs.example.com */
  handoffUrl: string;
  /** True when this deployment runs MCP (Postgres / DATABASE_URL). */
  mcpOnThisHost: boolean;
};

function buildMcpConfig(handoffUrl: string, token: string) {
  const url = handoffUrl ? `${handoffUrl}/api/mcp` : 'https://your-handoff.example.com/api/mcp';
  return {
    mcpServers: {
      handoff: {
        url,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

export default function McpSetupSection({ handoffUrl, mcpOnThisHost }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const cursorJson = useMemo(
    () => JSON.stringify(buildMcpConfig(handoffUrl, TOKEN_PLACEHOLDER), null, 2),
    [handoffUrl]
  );
  const claudeJson = cursorJson;

  const mcpUrl = handoffUrl ? `${handoffUrl}/api/mcp` : 'https://your-handoff.example.com/api/mcp';

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const tokenCmd = `node -p "require('./.handoff/cli-auth.json').accessToken"`;

  return (
    <section className="space-y-4 border-t pt-8">
      <h2 className="text-base font-semibold">4. MCP for Cursor &amp; Claude</h2>
      <p className="text-muted-foreground">
        Connect AI assistants to this Handoff deployment for reference materials, components, sync, design library, and
        design-to-component generation. MCP uses the same OAuth token as the CLI — run{' '}
        <code className="rounded bg-muted px-1">handoff-app login</code> first (step 1).
      </p>

      {!mcpOnThisHost ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100">
          This local server does not host MCP (no Postgres). Point MCP clients at your{' '}
          <strong>team Handoff URL</strong> — the same value as <code className="rounded bg-muted px-1">HANDOFF_CLOUD_URL</code>{' '}
          in your project <code className="rounded bg-muted px-1">.env</code>, not <code className="rounded bg-muted px-1">localhost</code>.
        </p>
      ) : (
        <p className="text-muted-foreground">
          MCP endpoint on this deployment:{' '}
          <code className="rounded bg-muted px-1 break-all">{mcpUrl}</code>
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Get your access token</h3>
        <p className="text-muted-foreground text-xs">
          After <code className="rounded bg-muted px-1">handoff-app login</code>, read{' '}
          <code className="rounded bg-muted px-1">.handoff/cli-auth.json</code> in your design repo (keep it out of git).
          Replace <code className="rounded bg-muted px-1">{TOKEN_PLACEHOLDER}</code> in the configs below.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{tokenCmd}</pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy('token-cmd', tokenCmd)}>
            {copied === 'token-cmd' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="cursor" className="w-full">
        <TabsList>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
          <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
        </TabsList>

        <TabsContent value="cursor" className="mt-4 space-y-3">
          <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-xs">
            <li>
              Create or edit <code className="rounded bg-muted px-1">.cursor/mcp.json</code> in your design repo (project-only), or{' '}
              <code className="rounded bg-muted px-1">~/.cursor/mcp.json</code> for all workspaces.
            </li>
            <li>
              Paste the config below, replace the token, then restart Cursor or open{' '}
              <strong>Cursor Settings → MCP</strong> and enable the <strong>handoff</strong> server.
            </li>
            <li>
              In chat, ask the agent to call <code className="rounded bg-muted px-1">handoff_get_project_context</code> first, then use
              reference, sync, or design tools. Pair with Figma MCP for design-to-code.
            </li>
          </ol>
          <div className="flex flex-wrap items-start gap-2">
            <pre className="max-w-full flex-1 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{cursorJson}</pre>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy('cursor-mcp', cursorJson)}>
              {copied === 'cursor-mcp' ? 'Copied' : 'Copy config'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="claude" className="mt-4 space-y-3">
          <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-xs">
            <li>
              Open <strong>Claude Desktop → Settings → Developer → Edit Config</strong> (macOS:{' '}
              <code className="rounded bg-muted px-1">~/Library/Application Support/Claude/claude_desktop_config.json</code>).
            </li>
            <li>
              Merge the <code className="rounded bg-muted px-1">mcpServers</code> block below into that file (or create the file if missing).
            </li>
            <li>Replace the token and fully quit/restart Claude Desktop.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-2">
            <pre className="max-w-full flex-1 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{claudeJson}</pre>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy('claude-mcp', claudeJson)}>
              {copied === 'claude-mcp' ? 'Copied' : 'Copy config'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer font-medium text-foreground">Common MCP tools</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code className="rounded bg-muted px-1">handoff_get_project_context</code> — stack profile, paths, Figma key (call first)
          </li>
          <li>
            <code className="rounded bg-muted px-1">handoff_get_reference</code> /{' '}
            <code className="rounded bg-muted px-1">handoff_get_stack_guide</code> — catalogs and authoring rules
          </li>
          <li>
            <code className="rounded bg-muted px-1">handoff_sync_pull</code> /{' '}
            <code className="rounded bg-muted px-1">handoff_sync_push</code> — team sync (patches applied in your repo)
          </li>
          <li>
            <code className="rounded bg-muted px-1">handoff_start_component_from_design</code> — design library → component job
          </li>
        </ul>
        <p className="mt-2">
          Full tool list and scopes: see <code className="rounded bg-muted px-1">docs/HANDOFF-MCP-RFC.md</code> in the handoff-app package.
        </p>
      </details>
    </section>
  );
}
