"use client";

import Image from "next/image";
import Link from "next/link";
import icon from "@/app/icon.png";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  MAIN_NAV,
  OVERVIEW_ITEM,
  SETTINGS_ITEM,
  TECHNICIAN_NAV,
  visibleNavItems,
  type NavItem,
} from "@/lib/nav/nav-config";
import { usePermissions } from "@/features/auth/use-permissions";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive(pathname, item.href)}
        tooltip={item.label}
      >
        <Link href={item.href}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { can, isTechnician } = usePermissions();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          className="flex items-center gap-2 px-1 py-1.5"
          aria-label="BitCRM home"
        >
          <Image
            src={icon}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span className="text-base font-bold tracking-tight group-data-[collapsible=icon]:hidden">
            BitCRM
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {isTechnician ? (
          <SidebarGroup>
            <SidebarMenu>
              {TECHNICIAN_NAV.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarMenu>
                <NavLink item={OVERVIEW_ITEM} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroup>

            {MAIN_NAV.map((group) => {
              const items = visibleNavItems(group.items, (r) => can(r));
              if (items.length === 0) return null;
              return (
                <SidebarGroup key={group.label}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarMenu>
                    {items.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              );
            })}
          </>
        )}
      </SidebarContent>

      {!isTechnician && can("settings") ? (
        <SidebarFooter>
          <SidebarMenu>
            <NavLink item={SETTINGS_ITEM} pathname={pathname} />
          </SidebarMenu>
        </SidebarFooter>
      ) : null}

      <SidebarRail />
    </Sidebar>
  );
}
