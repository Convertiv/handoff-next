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
import { useHandoffCapabilities } from '../context/HandoffCapabilitiesContext';

const TOOLS_PATHS = ['/design', '/patterns', '/playground'];

export function MainNav() {
  const caps = useHandoffCapabilities();
  const pathname = usePathname();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  const isToolsActive = TOOLS_PATHS.some((p) => pathname.startsWith(p));
  const isSystemActive = !isToolsActive;

  const toolsHref = caps.designWorkbench
    ? `${basePath}/design`
    : `${basePath}/patterns`;

  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink
            className={cn(navigationMenuTriggerStyle(), isSystemActive && 'bg-accent text-accent-foreground')}
            asChild
          >
            <Link href={`${basePath}/`}>System</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink
            className={cn(navigationMenuTriggerStyle(), isToolsActive && 'bg-accent text-accent-foreground')}
            asChild
          >
            <Link href={toolsHref}>Tools</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
