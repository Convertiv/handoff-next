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
import { useHandoffCapabilities } from '../context/HandoffCapabilitiesContext';

const trimSlashes = (input: string): string => {
  return input.replace(/^\/+|\/+$/g, '');
};

const CORE_DOC_LINKS = [
  { title: 'Foundations', path: '/foundations' },
  { title: 'Design System', path: '/system' },

];

export function MainNav() {
  const context = useConfigContext();
  const caps = useHandoffCapabilities();
  const pathname = usePathname();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const appToolLinks = [
    { title: 'Patterns', path: '/patterns' },
    { title: 'Playground', path: '/playground' },
    ...(caps.designWorkbench ? [{ title: 'Design', path: '/design' }] : []),
    ...(caps.designLibrary ? [{ title: 'Library', path: '/design/library' }] : []),
    ...(caps.designLibrary ? [{ title: 'Assets', path: '/design/assets' }] : []),
  ];
  const menuSections = (context.menu ?? []).filter((section) => Boolean(section?.path));
  const existingPaths = new Set(menuSections.map((s) => trimSlashes(s.path)));
  const fallbackLinks = [...CORE_DOC_LINKS, ...appToolLinks].filter((l) => !existingPaths.has(trimSlashes(l.path)));

  return (
    <NavigationMenu>
      <NavigationMenuList>
        {menuSections.map((section) => {
          const isActive = trimSlashes(pathname).startsWith(trimSlashes(section.path));
          const sectionTitle = section.title || section.path;
          return (
            <NavigationMenuItem key={`${section.path}-${sectionTitle}`}>
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
                      {sectionTitle}
                    </Link>
                  </NavigationMenuLink>
                </>
              ) : section.external ? (
                <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                  <Link href={section.external as string} target="_blank" rel="noopener noreferrer">
                    {sectionTitle}
                  </Link>
                </NavigationMenuLink>
              ) : (
                <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                  <Link
                    href={section.path}
                    className="block select-none space-y-1 rounded-sm p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                    {...(isActive ? { 'data-active': 'true' } : {})}
                  >
                    <span className="text-sm leading-none">{sectionTitle}</span>
                  </Link>
                </NavigationMenuLink>
              )}
            </NavigationMenuItem>
          );
        })}
        {fallbackLinks.map((section) => {
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
