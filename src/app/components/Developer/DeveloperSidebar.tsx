'use client';

import { BookOpen, Code2, Cpu, GitMerge, LayoutDashboard, Laptop } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';

const NAV = [
  { href: '/developer', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/developer/cli', label: 'CLI Reference', icon: Code2, exact: false },
  { href: '/developer/api', label: 'REST API', icon: BookOpen, exact: false },
  { href: '/developer/mcp', label: 'MCP Tools', icon: Cpu, exact: false },
  { href: '/developer/push-pull', label: 'Push / Pull Guide', icon: GitMerge, exact: false },
  { href: '/developer/local-setup', label: 'Local Development', icon: Laptop, exact: false },
];

export default function DeveloperSidebar() {
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href || pathname === href + '/' : pathname.startsWith(href);

  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 py-8 pr-6">
      <p className="mb-4 px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
        Developer
      </p>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              isActive(href, exact)
                ? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-100'
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-60" strokeWidth={1.5} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-800">
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Downloads
        </p>
        <a
          href="/openapi.yaml"
          download
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-100 transition-colors"
        >
          <BookOpen className="h-4 w-4 shrink-0 opacity-60" strokeWidth={1.5} />
          openapi.yaml
        </a>
      </div>
    </aside>
  );
}
