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
import { cn, normalizePathForMatch, toAbsolutePath, TOOLS_PATHS } from '../../lib/utils';
import { useConfigContext } from '../context/ConfigContext';
import { SectionLink } from '../util';

// Rendered if the menu hasn't loaded — mirrors the structural sections that
// are always present in config/docs (foundations.md, system.md).
const FALLBACK_SECTIONS: Pick<SectionLink, 'title' | 'path'>[] = [
  { title: 'Foundations', path: '/foundations' },
  { title: 'Design System', path: '/system' },
];

export function MainNav() {
  const pathname = usePathname();
  const { menu } = useConfigContext();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  // One top-nav item per knowledge section (Foundations, Design System, and
  // any project sections), excluding Tools routes and the legacy /assets
  // section (its content now lives under /foundations/assets).
  const knowledgeSections = ((menu ?? []) as SectionLink[]).filter(
    (s) => s.path && s.path !== '/assets' && !TOOLS_PATHS.some((p) => s.path.startsWith(p))
  );
  const sections = knowledgeSections.length > 0 ? knowledgeSections : FALLBACK_SECTIONS;

  const normalizedPathname = normalizePathForMatch(pathname);
  const isSectionActive = (path: string | undefined) => {
    const sectionPath = normalizePathForMatch(path);
    return (
      sectionPath.length > 0 &&
      (normalizedPathname === sectionPath || normalizedPathname.startsWith(`${sectionPath}/`))
    );
  };

  // Menu paths built on some runtimes already carry the base path — only
  // prefix when it isn't there yet.
  const sectionHref = (path: string) => {
    const abs = toAbsolutePath(path);
    return basePath && abs.startsWith(`${basePath}/`) ? abs : `${basePath}${abs}`;
  };

  const isToolsActive = TOOLS_PATHS.some((p) => normalizedPathname.startsWith(normalizePathForMatch(p)));

  // The Library lander is the home of the Tools section — it spans both builders'
  // output (designs + patterns) and launches into either builder.
  const toolsHref = `${basePath}/library`;

  return (
    <NavigationMenu>
      <NavigationMenuList>
        {sections.map((section) => (
          <NavigationMenuItem key={section.path}>
            <NavigationMenuLink
              className={cn(
                navigationMenuTriggerStyle(),
                isSectionActive(section.path) && 'bg-accent text-accent-foreground'
              )}
              asChild
            >
              <Link href={sectionHref(section.path)}>{section.title}</Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
        <NavigationMenuItem>
          <NavigationMenuLink
            className={cn(navigationMenuTriggerStyle(), isToolsActive && 'bg-accent text-accent-foreground')}
            asChild
          >
            <Link href={toolsHref}>Prototyping</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
