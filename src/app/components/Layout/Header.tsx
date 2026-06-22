'use client';

import { handoffApiUrl } from '@/lib/api-path';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { AuthControls } from '../Auth/AuthControls';
import { BuildBadge } from './BuildBadge';
import { ModeToggle } from '../../components/ModeSwitcher';
import { MainNav } from '../../components/Navigation/MainNav';
import { MobileNav } from '../../components/Navigation/MobileNav';
import { Button } from '../ui/button';
import { cn, normalizePathForMatch } from '../../lib/utils';
import { useAuthUi } from '../context/AuthUiContext';
import { useConfigContext } from '../context/ConfigContext';

const TOOLS_PATHS = ['/design', '/patterns', '/playground'];

function CliIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25z" />
      <path d="m8 9 3 3-3 3" />
      <path d="M13.5 15.25H16" />
    </svg>
  );
}

function ToolsSubNav() {
  const pathname = usePathname();
  const basePath = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

  const isToolsSection = TOOLS_PATHS.some((p) =>
    normalizePathForMatch(pathname).startsWith(normalizePathForMatch(p))
  );
  if (!isToolsSection) return null;

  const tools = [
    { href: `${basePath}/design`, label: 'Workbench' },
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
  const pathname = usePathname();
  const { authEnabled } = useAuthUi();
  const { data: session } = useSession();
  const [isScrolled, setIsScrolled] = useState(false);
  const showDevelopLocally = !authEnabled || Boolean(session?.user);
  const developLocallyActive = pathname.includes('developer/local-setup');

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      className={cn(
        'sticky top-0 z-50 py-4 shadow-[0_0_3px_0_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-300',
        isScrolled && 'bg-background/70 py-3 shadow-[0_0_4px_0_rgba(0,0,0,0.15)]'
      )}
    >
      <header className="border-grid container mx-auto w-full max-w-[1500px] bg-transparent px-8">
        <div className="mx-auto flex items-center justify-between @container">
          <Link href="/" className="inline-flex shrink-0 items-center">
            <img
              className="h-5 w-auto max-w-[160px] object-contain object-left"
              src={`${process.env.HANDOFF_APP_BASE_PATH ?? ''}/logo.svg`}
              alt={context.config?.app?.title}
            />
          </Link>
          <div className="hidden items-center gap-4 @2xl:flex">
            <MainNav />
            <BuildBadge />
            <AuthControls />
            <ModeToggle />
            {showDevelopLocally ? (
              <Button
                variant="ghost"
                size="icon"
                asChild
                className={cn(developLocallyActive && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
              >
                <Link href={handoffApiUrl('/developer/local-setup')} aria-label="Develop locally" title="Develop locally">
                  <CliIcon className="h-[1.1rem] w-[1.1rem]" />
                  <span className="sr-only">Develop locally</span>
                </Link>
              </Button>
            ) : null}
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
