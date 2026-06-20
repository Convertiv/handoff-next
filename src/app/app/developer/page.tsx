import { ArrowRight, BookOpen, Code2, Cpu, GitMerge } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

const CARDS = [
  {
    href: '/developer/cli',
    icon: Code2,
    title: 'CLI Reference',
    description:
      'Install handoff-app, authenticate with your registry, and run push, pull, fetch, and build commands from your workspace.',
  },
  {
    href: '/developer/api',
    icon: BookOpen,
    title: 'REST API',
    description:
      'Interactive OpenAPI 3.1 explorer. Try every endpoint, inspect schemas, and copy ready-to-use curl commands.',
  },
  {
    href: '/developer/mcp',
    icon: Cpu,
    title: 'MCP Tools',
    description:
      'Model Context Protocol tools for Cursor, Claude, and Windsurf. Connect your AI editor to design tokens, components, and icons.',
  },
  {
    href: '/developer/push-pull',
    icon: GitMerge,
    title: 'Push / Pull Guide',
    description:
      'Understand the sync protocol — what push:all sends, how the registry stores it, and how pull writes changes back to your workspace.',
  },
];

export default function DeveloperOverviewPage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Developer Docs</h1>
        <p className="mt-3 max-w-2xl text-base font-light text-gray-500 dark:text-gray-400">
          Everything you need to integrate Handoff into your workflow — CLI tools, the REST API, AI editor connections, and the
          workspace sync protocol.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-3 rounded-xl border border-gray-200 p-6 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-900/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <Icon className="h-4 w-4 text-gray-700 dark:text-gray-300" strokeWidth={1.5} />
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            </div>
            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
            <span className="mt-auto flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              View docs
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900/30">
        <h2 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">Quick start</h2>
        <ol className="flex flex-col gap-2 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              1
            </span>
            Install: <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-700">npm install -g handoff-app</code>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              2
            </span>
            Authenticate:{' '}
            <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-700">handoff-app login --url https://your-registry.vercel.app</code>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              3
            </span>
            Push all workspace data:{' '}
            <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-700">handoff-app push:all</code>
          </li>
        </ol>
        <div className="mt-4">
          <Link
            href="/developer/cli"
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal'}
          >
            Full CLI reference <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
