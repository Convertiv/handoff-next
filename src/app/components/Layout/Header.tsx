'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AuthControls } from '../Auth/AuthControls';
import { BuildBadge } from './BuildBadge';
import { ModeToggle } from '../../components/ModeSwitcher';
import { MainNav } from '../../components/Navigation/MainNav';
import { MobileNav } from '../../components/Navigation/MobileNav';
import { cn } from '../../lib/utils';
import { useConfigContext } from '../context/ConfigContext';
import { normalizePathForMatch } from '../../lib/utils';

const TOOLS_PATHS = ['/design', '/patterns', '/playground'];

function ToolsSubNav() {
  const pathname = usePathname();
  const basePath = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

  const isToolsSection = TOOLS_PATHS.some((p) =>
    normalizePathForMatch(pathname).startsWith(normalizePathForMatch(p))
  );
  if (!isToolsSection) return null;

  const tools = [
    { href: `${basePath}/design`, label: 'Workbench' },
    { href: `${basePath}/design/library`, label: 'Library' },
    { href: `${basePath}/playground`, label: 'Playground' },
    { href: `${basePath}/patterns`, label: 'Patterns' },
  ];

  return (
    <div className="border-t border-border/40">
      <nav className="container mx-auto flex max-w-[1500px] items-center justify-end gap-1 px-8 py-1">
        {tools.map(({ href, label }) => {
          const isActive = normalizePathForMatch(pathname).startsWith(normalizePathForMatch(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Header() {
  const context = useConfigContext();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      className={cn(
        'sticky top-0 z-50 shadow-[0_0_3px_0_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-300',
        isScrolled && 'bg-background/70 shadow-[0_0_4px_0_rgba(0,0,0,0.15)]'
      )}
    >
      <header className="border-grid container mx-auto w-full max-w-[1500px] bg-transparent px-8 py-4">
        <div className="mx-auto flex items-center justify-between @container">
          <Link href="/">
            <img className="max-h-5" src={`${process.env.HANDOFF_APP_BASE_PATH ?? ''}/logo.svg`} alt={context.config?.app?.title} />
          </Link>
          <div className="hidden items-center gap-4 @2xl:flex">
            <MainNav />
            <BuildBadge />
            <AuthControls />
            <ModeToggle />
          </div>
          <div className="flex items-center gap-4 @2xl:hidden">
            <MobileNav />
          </div>
        </div>
      </header>
      <ToolsSubNav />
    </div>
  );
}
