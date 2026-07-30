'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthControls } from '../Auth/AuthControls';
import { ModeToggle } from '../../components/ModeSwitcher';
import { MainNav } from '../../components/Navigation/MainNav';
import { MobileNav } from '../../components/Navigation/MobileNav';
import { cn } from '../../lib/utils';
import { useConfigContext } from '../context/ConfigContext';

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
        'sticky top-0 z-50 py-4 shadow-[0_0_3px_0_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-300',
        isScrolled && 'bg-background/70 py-3 shadow-[0_0_4px_0_rgba(0,0,0,0.15)]'
      )}
    >
      <header className="border-grid container mx-auto w-full max-w-[1500px] bg-transparent px-8">
        <div className="mx-auto flex items-center justify-between @container">
          <Link href="/" className="inline-flex shrink-0 items-center">
            <img
              className="h-5 w-auto max-w-[160px] object-contain object-left"
              src={`${process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? ''}/api/registry/logo.svg`}
              alt={context.config?.app?.title}
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  `${process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? ''}/logo.svg`;
              }}
            />
          </Link>
          <div className="hidden items-center gap-4 @2xl:flex">
            <MainNav />
            <AuthControls />
            <ModeToggle />
          </div>
          <div className="flex items-center gap-4 @2xl:hidden">
            <MobileNav />
          </div>
        </div>
      </header>
    </div>
  );
}
