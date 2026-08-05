import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { buttonVariants } from '@/components/ui/button';
import { isPostgres } from '@/lib/db/dialect';
import McpSetupSection from '@/app/dev/local-setup/McpSetupSection';
import { getMcpToolCatalog, CATEGORY_ORDER } from '@/lib/mcp/tool-catalog';

export const dynamic = 'force-dynamic';

/** Resolve this deployment's public origin (+ base path) for real, copy-pasteable config. */
async function resolveOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const base = (process.env.HANDOFF_APP_BASE_PATH ?? '').replace(/\/+$/, '');
    return `${proto}://${host}${base}`;
  } catch {
    return '';
  }
}

export default async function McpPage() {
  const origin = await resolveOrigin();
  const mcpOnThisHost = isPostgres();
  const tools = getMcpToolCatalog();
  const categories = CATEGORY_ORDER.filter((cat) => tools.some((t) => t.category === cat));
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">MCP Tools</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          Handoff exposes a Model Context Protocol server at{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono dark:bg-gray-800">
            {origin ? `${origin}/api/mcp` : '/api/mcp'}
          </code>
          . Connect Cursor, Claude, or Windsurf to read design tokens, search components, look up icons, and generate components from design artifacts.
        </p>
      </div>

      {/* Setup — shared with the local-setup guide, filled with this deployment's real domain */}
      <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
        <McpSetupSection handoffUrl={origin} mcpOnThisHost={mcpOnThisHost} heading="Setup — Cursor & Claude" bare />
        <Link
          href="/developer/local-setup"
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' mt-4 self-start font-normal'}
        >
          Full local setup guide <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Tool reference — generated from the live MCP server registration */}
      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{cat}</h2>
          <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {tools
              .filter((t) => t.category === cat)
              .map((tool) => (
                <div key={tool.name} className="px-5 py-4">
                  <div className="flex flex-col gap-1.5">
                    <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{tool.name}</code>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{tool.description}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
