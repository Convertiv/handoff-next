'use client';

import { Bot, Plug, UserCircle, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Layout from '../../components/Layout/Main';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '../../components/ui/sidebar';

const accountNavGroups = [
  {
    label: 'Account',
    items: [
      { href: '/account', label: 'Profile', icon: UserCircle, adminOnly: false, exact: true },
      { href: '/account/integrations', label: 'Integrations', icon: Plug, adminOnly: true, exact: false },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/account/users', label: 'Users', icon: Users, adminOnly: true, exact: false },
      { href: '/account/ai-cost', label: 'AI Cost', icon: Bot, adminOnly: true, exact: false },
    ],
  },
];

function AccountSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visibleGroups = accountNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  const isActive = (href: string, exact: boolean) => {
    return exact ? pathname === href || pathname === `${href}/` : pathname.startsWith(href);
  };

  return (
    <Sidebar className="sticky left-auto">
      <SidebarContent className="px-4 pt-5">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ href, label, icon: Icon, exact }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={isActive(href, exact)}>
                      <Link href={href} className="gap-2.5">
                        <Icon className="h-4 w-4 opacity-60" strokeWidth={1.5} />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

export default function AccountLayoutClient({
  children,
  config,
  menu,
  isAdmin,
}: {
  children: React.ReactNode;
  config: any;
  menu: any;
  isAdmin: boolean;
}) {
  const layoutMeta = { metaTitle: 'Account', metaDescription: 'Manage your profile and workspace settings' };

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta} fullWidthHero>
      <SidebarProvider style={{ '--sidebar-width': '20rem' } as React.CSSProperties}>
        <AccountSidebar isAdmin={isAdmin} />
        <SidebarInset className="relative bg-transparent py-8 pl-8 pr-8 md:pl-8 lg:gap-10 lg:py-16 lg:pl-16">
          <div className="mx-auto w-full max-w-4xl space-y-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </Layout>
  );
}
