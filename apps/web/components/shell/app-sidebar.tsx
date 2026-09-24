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
import { InboxNavBadge } from "@/features/messaging/components/inbox-nav-badge";
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
      {/* Unread threads, the way Workiz badges its Inbox — only on that item. */}
      {item.href === "/messages" ? <InboxNavBadge /> : null}
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
          // Workiz's: a yellow dot with a plus and a label on a plain white
          // row, which becomes a bordered oval under the cursor. The yellow
          // stays in the dot — the row itself carries none of it.
          <Button
            asChild
            variant="ghost"
            className="h-9 w-full justify-start gap-2 overflow-hidden border border-transparent px-1.5 transition-[width,height,border-radius] duration-200 ease-linear hover:rounded-full hover:border-border hover:bg-card group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8"
          >
            <Link href="/deals/new">
              <span
                data-slot="new-job-dot"
                className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
              >
                <Plus className="size-4" />
              </span>
              <span className="whitespace-nowrap transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
                Create New Job
              </span>
            </Link>
          </Button>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {isTechnician ? (
          <SidebarGroup>
            <SidebarMenu>
              {visibleNavItems(TECHNICIAN_NAV, (r) => can(r)).map((item) => (
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
