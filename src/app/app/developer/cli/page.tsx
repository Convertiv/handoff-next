import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

type Command = { cmd: string; description: string; flags?: { flag: string; description: string }[] };

const COMMANDS: Command[] = [
  {
    cmd: 'handoff-app login',
    description: 'Authenticate with a registry via browser OAuth device flow. Saves credentials to .handoff/cli-auth.json.',
    flags: [
      { flag: '--url <url>', description: 'Registry URL (e.g. https://your-registry.vercel.app)' },
    ],
  },
  {
    cmd: 'handoff-app push:all',
    description: 'Push all workspace data to the registry in sequence: config, theme, navigation, pages, tokens, DTCG tokens, icons, logos.',
    flags: [],
  },
  {
    cmd: 'handoff-app push',
    description: 'Push individual components, patterns, and pages via POST /api/sync/upload. Skips unchanged files.',
    flags: [],
  },
  {
    cmd: 'handoff-app pull',
    description: 'Pull changeset from the registry and write back to the workspace — pages, component declarations, build artifacts, source files.',
    flags: [],
  },
  {
    cmd: 'handoff-app fetch',
    description: 'Pull design tokens from Figma into public/api/tokens/. Requires FIGMA_PROJECT_ID and FIGMA_DEVELOPER_ACCESS_TOKEN.',
    flags: [],
  },
  {
    cmd: 'handoff-app dev',
    description: 'Run a local filesystem-backed preview of the design system site (workspace dev mode — no database required).',
    flags: [],
  },
  {
    cmd: 'handoff-app build',
    description: "Build a component's Vite bundle locally and write artifacts to components/[id]/dist/.",
    flags: [{ flag: '<componentId>', description: 'Component identifier' }],
  },
  {
    cmd: 'handoff-app init:vercel',
    description: 'Scaffold a vercel.json and .env.example for deploying this app as a registry on Vercel.',
    flags: [],
  },
];

const PUSH_TABLE = [
  { endpoint: 'POST /api/registry/config', source: 'handoff.config.js app block' },
  { endpoint: 'POST /api/registry/theme', source: 'theme.css' },
  { endpoint: 'POST /api/registry/navigation', source: 'pages/ directory tree' },
  { endpoint: 'POST /api/registry/pages', source: 'pages/**/*.md' },
  { endpoint: 'POST /api/registry/tokens', source: 'public/api/tokens.json' },
  { endpoint: 'POST /api/registry/dtcg', source: 'design-system/manifest.json + dist/' },
  { endpoint: 'POST /api/registry/icons', source: 'icons/catalog.json (flat IconCatalogEntry[])' },
  { endpoint: 'POST /api/registry/logos', source: 'logos/logo-set.json (LogoSet object)' },
];

export default function CliPage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">CLI Reference</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm dark:bg-gray-800">handoff-app</code> is the workspace CLI.
          Install it globally and run all commands from your workspace's <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">handoff/</code> directory.
        </p>
      </div>

      {/* Install */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Installation</h2>
        </div>
        <div className="p-6 flex flex-col gap-3">
          <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
            <code>npm install -g handoff-app</code>
          </pre>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Or install as a dev dependency and run via <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">npx handoff-app &lt;cmd&gt;</code>.
          </p>
        </div>
      </div>

      {/* Auth */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Authentication</h2>
        </div>
        <div className="p-6 flex flex-col gap-3">
          <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
            <code>{`handoff-app login --url https://your-registry.vercel.app`}</code>
          </pre>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Opens a browser device-code flow. After approving, credentials are saved to{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">.handoff/cli-auth.json</code>.
            All subsequent push/pull commands use this token automatically.
          </p>
          <Link
            href="/cli/device"
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' self-start font-normal'}
          >
            Authorize CLI device <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Commands */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Commands</h2>
        <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {COMMANDS.map(({ cmd, description, flags }) => (
            <div key={cmd} className="px-5 py-4">
              <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{cmd}</code>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
              {flags && flags.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {flags.map((f) => (
                    <div key={f.flag} className="flex gap-3 text-xs">
                      <code className="w-44 shrink-0 font-mono text-gray-500 dark:text-gray-400">{f.flag}</code>
                      <span className="text-gray-500 dark:text-gray-400">{f.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* push:all detail */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">push:all — step by step</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Endpoint</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {PUSH_TABLE.map(({ endpoint, source }) => (
                <tr key={endpoint}>
                  <td className="px-5 py-3 font-mono text-xs text-gray-800 dark:text-gray-200">{endpoint}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Env vars */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Environment variables</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Variable</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
              {[
                ['HANDOFF_CLOUD_URL', 'Registry base URL (e.g. https://ssc-handoff.vercel.app)'],
                ['HANDOFF_CLOUD_TOKEN', 'Bearer token — only needed for CI; prefer handoff-app login for local dev'],
                ['FIGMA_PROJECT_ID', 'Figma file key for handoff-app fetch'],
                ['FIGMA_DEVELOPER_ACCESS_TOKEN', 'Figma personal access token for handoff-app fetch'],
                ['DATABASE_URL', 'Postgres connection string (registry server only — not needed in workspaces)'],
              ].map(([v, d]) => (
                <tr key={v}>
                  <td className="px-5 py-3 font-mono text-gray-800 dark:text-gray-200">{v}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
