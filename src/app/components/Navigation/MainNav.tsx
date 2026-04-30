'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '../../components/ui/navigation-menu';
import { cn } from '../../lib/utils';
import { useConfigContext } from '../context/ConfigContext';

const trimSlashes = (input: string): string => {
  return input.replace(/^\/+|\/+$/g, '');
};

const isDynamicBuild = (process.env.NEXT_PUBLIC_HANDOFF_MODE ?? '') === 'dynamic';

const APP_TOOL_LINKS = [
  { title: 'Patterns', path: '/patterns' },
  { title: 'Playground', path: '/playground' },
  ...(isDynamicBuild ? [{ title: 'Saved designs', path: '/designs' }] : []),
];

export function MainNav() {
  const context = useConfigContext();
  const pathname = usePathname();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const existingPaths = new Set((context.menu ?? []).map((s) => trimSlashes(s.path)));
  const extraNav = APP_TOOL_LINKS.filter((l) => !existingPaths.has(trimSlashes(l.path)));

  return (
    <NavigationMenu>
      <NavigationMenuList>
        {context.menu &&
          context.menu.map((section) => {
            const isActive = trimSlashes(pathname).startsWith(trimSlashes(section.path));
            return (
              <NavigationMenuItem key={section.title}>
                {section.subSections && section.subSections.length > 0 ? (
                  <>
                    <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                      <Link
                        href={section.path}
                        className={cn(
                          'block select-none space-y-1 rounded-sm p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground'
                        )}
                        {...(isActive ? { 'data-active': 'true' } : {})}
                      >
                        {section.title}
                      </Link>
                    </NavigationMenuLink>
                  </>
                ) : section.external ? (
                  <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                    <Link href={section.external as string} target="_blank" rel="noopener noreferrer">
                      {section.title}
                    </Link>
                  </NavigationMenuLink>
                ) : (
                  <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                    <Link
                      href={section.path}
                      className="block select-none space-y-1 rounded-sm p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                      {...(isActive ? { 'data-active': 'true' } : {})}
                    >
                      <span className="text-sm leading-none">{section.title}</span>
                    </Link>
                  </NavigationMenuLink>
                )}
              </NavigationMenuItem>
            );
          })}
        {extraNav.map((section) => {
          const href = `${basePath}${section.path}`;
          const isActive = trimSlashes(pathname).startsWith(trimSlashes(section.path));
          return (
            <NavigationMenuItem key={`tool-${section.path}`}>
              <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                <Link
                  href={href}
                  className="block select-none space-y-1 rounded-sm p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  {...(isActive ? { 'data-active': 'true' } : {})}
                >
                  <span className="text-sm leading-none">{section.title}</span>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
