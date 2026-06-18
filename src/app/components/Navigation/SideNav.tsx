'use client';

import {
  ChevronRight,
  Grid,
  Hexagon,
  Image,
  Layers,
  LayoutPanelLeft,
  Palette,
  Pickaxe,
  Ruler,
  Shapes,
  Sparkles,
  SquareChartGantt,
  Sun,
  TypeOutline,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';

import { usePathname } from 'next/navigation';
import React from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarSeparator,
} from '../../components/ui/sidebar';
import { cn, normalizePathForMatch, toAbsolutePath } from '../../lib/utils';
import { SectionLink } from '../util';
import { useHandoffCapabilities } from '../context/HandoffCapabilitiesContext';

const TOOLS_PATHS = ['/design', '/patterns', '/playground'];

const NormalMenuItem = ({ title, icon, path }) => {
  const pathname = usePathname();
  const isActive = normalizePathForMatch(path) === normalizePathForMatch(pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <a href={toAbsolutePath(path)} className="gap-3">
          <MenuIcon icon={icon} isActive={isActive} />
          <span>{title}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const CollapsibleMenuItem = ({ title, icon, path, menu }) => {
  const pathname = usePathname();
  const isActive = menu.some(
    (item) => normalizePathForMatch(pathname).startsWith(normalizePathForMatch(item.path))
  );
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className="h-9 gap-3">
            <MenuIcon icon={icon} isActive={isActive} />
            <span className={isActive ? 'font-medium text-sidebar-accent-foreground [&_svg]:opacity-100' : undefined}>{title}</span>
            <ChevronRight className="ml-auto size-[14px]! stroke-[1.5] text-slate-700 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="pl-3">
            <SidebarMenu>
              {menu.map((item) => (
                <MenuItem key={item.path} item={item} />
              ))}
            </SidebarMenu>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
};

const MenuItem = ({ item }) => {
  if (item.menu && item.menu.length > 0) {
    return <CollapsibleMenuItem {...item} />;
  } else {
    return <NormalMenuItem {...item} />;
  }
};

const MenuIcon = ({ icon, isActive = false }) => {
  const iconClass = isActive ? 'text-slate-800 opacity-100' : 'text-slate-700 opacity-50';

  switch (icon) {
    case 'layers':
      return <Layers className={iconClass} strokeWidth={1.5} />;
    case 'square-chart-gantt':
      return <SquareChartGantt className={iconClass} strokeWidth={1.5} />;
    case 'pickaxe':
      return <Pickaxe className={iconClass} strokeWidth={1.5} />;
    case 'hexagon':
      return <Hexagon className={iconClass} strokeWidth={1.5} />;
    case 'palette':
      return <Palette className={iconClass} strokeWidth={1.5} />;
    case 'type':
      return <TypeOutline className={iconClass} strokeWidth={1.5} />;
    case 'grid':
      return <Grid className={iconClass} strokeWidth={1.5} />;
    case 'layout-panel-left':
      return <LayoutPanelLeft className={iconClass} strokeWidth={1.5} />;
    case 'rulers':
      return <Ruler className={iconClass} strokeWidth={1.5} />;
    case 'sun':
      return <Sun className={iconClass} strokeWidth={1.5} />;
    case 'effect':
    case 'effects':
    case 'sparkles':
      return <Sparkles className={iconClass} strokeWidth={1.5} />;
    case 'blend':
      return <Sun className={iconClass} strokeWidth={1.5} />;
    case 'image':
      return <Image className={iconClass} strokeWidth={1.5} />;
    case 'shapes':
      return <Shapes className={iconClass} strokeWidth={1.5} />;
    default:
      return null;
  }
};

/**
 * Render rules for a sidebar subSection. A subSection can be:
 *  - A GROUP (no `path`, has `menu`) → group label + items inside
 *  - A NESTED GROUP (no `path`, has `menu`) — same as above
 *  - A LEAF LINK (`path` set, no/empty `menu`) → render as a direct link
 *  - A LEAF WITH CHILDREN (`path` set AND `menu` set) → render as a
 *    collapsible link (header link + nested items)
 *  - Empty (no path, no menu) → skip
 *
 * The previous version only handled the "group with menu" case — anything
 * else rendered an empty <SidebarGroup>, which is why registry sidebars on
 * foundations/guidelines showed empty divs whenever DB nav didn't push an
 * explicit frontmatter `menu:`.
 */
const renderSubSection = (
  section: SectionLink['subSections'][number] & { menu?: unknown[] },
  index: number,
  total: number
): React.ReactElement | null => {
  const hasPath = typeof section.path === 'string' && section.path.length > 0;
  const subMenu = Array.isArray(section.menu) ? (section.menu as Array<{ path?: string; title?: string; menu?: unknown[]; icon?: string; image?: string }>) : [];
  const hasMenu = subMenu.length > 0;
  if (!hasPath && !hasMenu) return null;

  return (
    <React.Fragment key={index}>
      <SidebarGroup>
        {/* Group header: label when no path, link when there is one */}
        {hasPath ? (
          <SidebarGroupContent>
            <SidebarMenu>
              <MenuItem item={{ title: section.title, path: section.path, menu: hasMenu ? subMenu : undefined } as Parameters<typeof MenuItem>[0]['item']} />
            </SidebarMenu>
          </SidebarGroupContent>
        ) : (
          <>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            {hasMenu && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {subMenu.map((item, subindex) => (
                    <MenuItem key={`${index}-mi-${subindex}`} item={item as Parameters<typeof MenuItem>[0]['item']} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </>
        )}
      </SidebarGroup>
      {index < total - 1 && <SidebarSeparator className="mx-4" />}
    </React.Fragment>
  );
};

type SideNavProps = {
  menu: SectionLink;
  topNav?: SectionLink[];
};

const SideNav = ({ menu, topNav }: SideNavProps) => {
  const pathname = usePathname();
  const caps = useHandoffCapabilities();
  const basePath = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

  const isToolsSection = TOOLS_PATHS.some((p) =>
    normalizePathForMatch(pathname).startsWith(normalizePathForMatch(p))
  );

  // Tools sidebar suppressed — navigation handled by ToolsSubNav in Header.

  // ── Knowledge section: cross-section nav with current section expanded ───
  if (!isToolsSection && topNav && topNav.length > 0) {
    return (
      <Sidebar className="sticky left-auto">
        <SidebarContent className="px-4 pt-5">
          {topNav.map((section, idx) => {
            const isSectionActive = normalizePathForMatch(pathname).startsWith(
              normalizePathForMatch(section.path)
            );
            const subSections = (section.subSections ?? []) as Array<
              SectionLink['subSections'][number] & { menu?: unknown[] }
            >;
            const hasSubSections = subSections.length > 0;

            return (
              <React.Fragment key={section.path}>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {hasSubSections ? (
                        <Collapsible defaultOpen={isSectionActive} className="group/collapsible">
                          <SidebarMenuItem>
                            {/* Custom trigger — avoids SidebarMenuButton's hardcoded [&>span:last-child]:truncate */}
                            <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                              <span
                                className={cn(
                                  'flex-1 text-left leading-snug',
                                  isSectionActive
                                    ? 'font-medium text-sidebar-accent-foreground'
                                    : 'text-sidebar-foreground'
                                )}
                              >
                                {section.title}
                              </span>
                              <ChevronRight className="size-[14px] shrink-0 stroke-[1.5] text-slate-700 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <SidebarMenuSub className="pl-3">
                                <SidebarMenu>
                                  {subSections.map((sub, subIdx) => (
                                    <MenuItem
                                      key={`${idx}-${subIdx}`}
                                      item={sub as Parameters<typeof MenuItem>[0]['item']}
                                    />
                                  ))}
                                </SidebarMenu>
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </SidebarMenuItem>
                        </Collapsible>
                      ) : (
                        <NormalMenuItem title={section.title} path={section.path} icon={null} />
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
                {idx < topNav.length - 1 && <SidebarSeparator className="mx-4" />}
              </React.Fragment>
            );
          })}
        </SidebarContent>
      </Sidebar>
    );
  }

  // ── Fallback: current section's own sub-sections only ────────────────────
  const subSections = (menu?.subSections ?? []) as Array<SectionLink['subSections'][number]>;
  return (
    <Sidebar className="sticky left-auto">
      <SidebarContent className="px-4 pt-5">
        {subSections
          .map((section, idx) => renderSubSection(section, idx, subSections.length))
          .filter(Boolean)}
      </SidebarContent>
    </Sidebar>
  );
};

export default SideNav;
