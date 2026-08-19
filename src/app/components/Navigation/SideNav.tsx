'use client';

import {
  BookOpen,
  BracketsCurly,
  Books,
  CaretRight,
  ChartBarHorizontal,
  Code,
  Columns,
  Cpu,
  Crosshair,
  FileCode,
  FileJs,
  FileText,
  GitMerge,
  GridFour,
  Hammer,
  Lock,
  Hexagon,
  Image,
  Laptop,
  Lightning,
  Package,
  PaintBrush,
  Palette,
  Plug,
  Robot,
  Ruler,
  Shapes,
  Shovel,
  Sparkle,
  Square,
  SquaresFour,
  Stack,
  Sun,
  TextT,
  UserCircle,
  Users,
} from '@phosphor-icons/react';
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
import { cn, normalizePathForMatch, toAbsolutePath, TOOLS_PATHS } from '../../lib/utils';
import { SectionLink } from '../util';
import { BuildsCountBadge } from '../Layout/BuildBadge';
import { useHandoffCapabilities } from '../context/HandoffCapabilitiesContext';

const NormalMenuItem = ({ title, icon, path }) => {
  const pathname = usePathname();
  const isActive = normalizePathForMatch(path) === normalizePathForMatch(pathname);
  const isBuildsItem = normalizePathForMatch(path) === normalizePathForMatch('/admin/builds');
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} className="h-9 px-4 [&>svg]:size-[15px]">
        <a href={toAbsolutePath(path)} className="group/nav-item gap-3">
          <MenuIcon icon={icon} isActive={isActive} />
          <span>{title}</span>
          {isBuildsItem ? <BuildsCountBadge /> : null}
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const CollapsibleMenuItem = ({ title, icon, path, menu }) => {
  const pathname = usePathname();
  const isActive = menu.some(
    (item) => item.path && normalizePathForMatch(pathname).startsWith(normalizePathForMatch(item.path))
  );
  // Check one level deeper — if any child has a nested menu whose items match
  // (component type groups: section → group → leaf), also open by default.
  const isDeepActive = !isActive && menu.some((item) =>
    Array.isArray(item.menu) && item.menu.some(
      (sub) => sub.path && normalizePathForMatch(pathname).startsWith(normalizePathForMatch(sub.path))
    )
  );
  return (
    <Collapsible defaultOpen={isActive || isDeepActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className="group/nav-item h-9 gap-3 px-4 [&>svg]:size-[15px]">
            <MenuIcon icon={icon} isActive={isActive} />
            <span className={isActive ? 'font-medium text-sidebar-accent-foreground [&_svg]:opacity-100' : undefined}>{title}</span>
            <CaretRight className="ml-auto size-[14px]! text-slate-700 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
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
  const iconClass = isActive
    ? 'text-slate-800 opacity-100'
    : 'text-slate-700 opacity-50 group-hover/nav-item:text-slate-800 group-hover/nav-item:opacity-100';

  switch (icon) {
    case 'layers':
      return <Stack className={iconClass} />;
    case 'square-chart-gantt':
      return <ChartBarHorizontal className={iconClass} />;
    case 'pickaxe':
      return <Shovel className={iconClass} />;
    case 'hexagon':
      return <Hexagon className={iconClass} />;
    case 'palette':
      return <Palette className={iconClass} />;
    case 'type':
      return <TextT className={iconClass} />;
    case 'grid':
      return <GridFour className={iconClass} />;
    case 'layout-panel-left':
      return <Columns className={iconClass} />;
    case 'rulers':
      return <Ruler className={iconClass} />;
    case 'sun':
      return <Sun className={iconClass} />;
    case 'effect':
    case 'effects':
    case 'sparkles':
      return <Sparkle className={iconClass} />;
    case 'blend':
      return <Sun className={iconClass} />;
    case 'image':
      return <Image className={iconClass} />;
    case 'shapes':
      return <Shapes className={iconClass} />;
    case 'square':
      return <Square className={iconClass} />;
    case 'zap':
      return <Lightning className={iconClass} />;
    case 'focus':
      return <Crosshair className={iconClass} />;
    case 'library':
      return <Books className={iconClass} />;
    case 'layout-dashboard':
      return <SquaresFour className={iconClass} />;
    case 'code':
      return <Code className={iconClass} />;
    case 'book-open':
      return <BookOpen className={iconClass} />;
    case 'cpu':
      return <Cpu className={iconClass} />;
    case 'git-merge':
      return <GitMerge className={iconClass} />;
    case 'laptop':
      return <Laptop className={iconClass} />;
    case 'braces':
      return <BracketsCurly className={iconClass} />;
    case 'file-json':
      return <FileJs className={iconClass} />;
    case 'file-code':
      return <FileCode className={iconClass} />;
    case 'package':
      return <Package className={iconClass} />;
    case 'user-circle':
      return <UserCircle className={iconClass} />;
    case 'plug':
      return <Plug className={iconClass} />;
    case 'users':
      return <Users className={iconClass} />;
    case 'paintbrush':
      return <PaintBrush className={iconClass} />;
    case 'bot':
      return <Robot className={iconClass} />;
    case 'file-text':
      return <FileText className={iconClass} />;
    case 'hammer':
      return <Hammer className={iconClass} />;
    case 'lock':
      return <Lock className={iconClass} />;
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

  // ── Knowledge section: show only the section the current page lives in ──
  // (e.g. Foundations pages get the Foundations menu, System pages get the
  // Design System menu). Pages that match no section fall through to the
  // current-section fallback below.
  if (!isToolsSection && topNav && topNav.length > 0) {
    const normalizedPathname = normalizePathForMatch(pathname);
    const activeSection = topNav.find((section) => {
      const sectionPath = normalizePathForMatch(section.path);
      return (
        sectionPath.length > 0 &&
        (normalizedPathname === sectionPath || normalizedPathname.startsWith(`${sectionPath}/`))
      );
    });

    if (activeSection) {
      const subSections = (activeSection.subSections ?? []) as Array<
        SectionLink['subSections'][number] & { menu?: unknown[] }
      >;

      return (
        <Sidebar className="sticky left-auto">
          <SidebarContent className="px-1 pt-5">
            <SidebarGroup>
              <SidebarGroupLabel className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {activeSection.title}
              </SidebarGroupLabel>
              {subSections.length > 0 && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {subSections.map((sub, subIdx) => (
                      <MenuItem
                        key={`section-${subIdx}`}
                        item={sub as Parameters<typeof MenuItem>[0]['item']}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      );
    }
  }

  // ── Fallback: current section's own sub-sections only ────────────────────
  const subSections = (menu?.subSections ?? []) as Array<SectionLink['subSections'][number]>;
  return (
    <Sidebar className="sticky left-auto">
      <SidebarContent className="px-1 pt-5">
        {subSections
          .map((section, idx) => renderSubSection(section, idx, subSections.length))
          .filter(Boolean)}
      </SidebarContent>
    </Sidebar>
  );
};

export default SideNav;
