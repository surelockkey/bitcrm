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
import { Plus } from "lucide-react";
import { Button } from "../ui/button";

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
        {/* Constant padding keeps the icon's x-position identical in both
            sidebar states, so nothing jumps while the width animates; the
            wordmark clips (overflow-hidden) and fades instead of popping. */}
        <Link
          href="/"
          className="flex items-center gap-2 overflow-hidden px-0.5 py-1.5"
          aria-label="BitCRM home"
        >
          <Image
            src={icon}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span className="whitespace-nowrap text-base font-bold tracking-tight transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
            BitCRM
          </span>
        </Link>
        {can("deals", "create") ? (
          <Button
            asChild
            variant="brand"
            className="h-9 w-30 justify-start gap-1.5 overflow-hidden px-2 transition-[width,height] duration-200 ease-linear group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8"
          >
            <Link href="/deals/new">
              <Plus className="size-4 shrink-0" />
              <span className="whitespace-nowrap transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
                New Job
              </span>
            </Link>
          </Button>
        ) : null}
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
                      <NavLink
                        key={item.href}
                        item={item}
                        pathname={pathname}
                      />
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
