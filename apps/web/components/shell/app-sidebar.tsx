"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import icon from "@/app/icon.png";
import wordmark from "@/components/brand/wordmark.png";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  FEATURES_HEADING,
  MAIN_NAV,
  OVERVIEW_ITEM,
  TECHNICIAN_NAV,
  visibleNavItems,
  type NavItem,
} from "@/lib/nav/nav-config";
import { usePermissions } from "@/features/auth/use-permissions";
import { InboxNavBadge } from "@/features/messaging/components/inbox-nav-badge";
import { cn } from "@/lib/utils";
import { CreateNewMenu } from "./create-new-menu";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Workiz's menu row (app_audit_wz_home, nodeMenu): 184×35 at x=8, 8px in,
 * 4px corners, a 16px glyph, 10px, then 13px/19px words at x=42; rows 8px
 * apart (43px pitch); #f3f6f7 under the cursor, #e5f1ff for the open page.
 * A sub-row (under Features) starts 8px further in.
 */
function NavLink({ item, pathname, sub }: { item: NavItem; pathname: string; sub?: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem
      className={cn("py-1", sub && "px-2 transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-0")}
      data-nav-sub={sub ? "true" : undefined}
    >
      <SidebarMenuButton
        asChild
        size="wz"
        isActive={isActive(pathname, item.href)}
        tooltip={item.label}
      >
        <Link href={item.href}>
          <Icon strokeWidth={1.5} />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {/* Unread threads, the way Workiz badges its Inbox — only on that item. */}
      {item.href === "/messages" ? <InboxNavBadge /> : null}
    </SidebarMenuItem>
  );
}

/** Workiz's rule between two blocks: 1px #dfe2e3, 184 wide, 8px from the rows either side. */
function NavRule() {
  return <div data-slot="nav-rule" aria-hidden className="my-1 h-px shrink-0 bg-sidebar-border" />;
}

/**
 * Workiz's "Features" block: a 600-weight heading row (its words open
 * Workiz's marketplace, which we have no counterpart for, so here they head
 * the block and open nothing), then the "MY FEATURES" caption that folds the
 * indented sub-rows — 11px/500 #9ea6aa capitals after an 18px chevron,
 * 12px under the heading row and 8px over the first sub-row.
 */
function FeaturesBlock({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(true);
  const Icon = FEATURES_HEADING.icon;
  return (
    <>
      <div className="py-1">
        <div className="flex h-[35px] items-center gap-[10px] overflow-hidden rounded-[4px] px-2 text-[13px] leading-[19px] font-semibold text-sidebar-foreground transition-[width] duration-200 ease-linear group-data-[collapsible=icon]:w-8 [&_svg]:size-4 [&_svg]:shrink-0">
          <Icon strokeWidth={1.5} />
          <span className="truncate transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
            {FEATURES_HEADING.label}
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-2 mb-1 flex h-[19px] w-full shrink-0 items-center gap-2 overflow-hidden px-4 text-[11px] leading-[19px] font-medium tracking-[0.4px] text-wz-outline uppercase transition-opacity duration-200 ease-linear outline-none group-data-[collapsible=icon]:opacity-0 focus-visible:underline"
      >
        <ChevronDown
          aria-hidden
          strokeWidth={1.5}
          className={cn("size-[18px] shrink-0 transition-transform duration-200", !open && "-rotate-90")}
        />
        <span className="truncate">My features</span>
      </button>
      {open ? (
        <SidebarMenu>
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} sub />
          ))}
        </SidebarMenu>
      ) : null}
    </>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { can, isTechnician, isLoading: permsLoading } = usePermissions();

  // The blocks this reader may see, in Workiz's order; an empty block leaves
  // no rule behind.
  const blocks = isTechnician
    ? []
    : MAIN_NAV.map((group) => ({ ...group, items: visibleNavItems(group.items, (r) => can(r)) })).filter(
        (group) => group.items.length > 0,
      );

  return (
    <Sidebar collapsible="icon">
      {/* 7px at the right: the rail is 200px with its 1px rule inside, so
          Workiz's 184px rows (8px in, 8px short of the rule) end at x=192. */}
      <SidebarHeader className="gap-0 p-2 pr-[7px] pb-0">
        {/* The SHMORKIZ pill, at Workiz's logo size (80×26). It is too wide
            for the collapsed rail, so there it clips (overflow-hidden) and
            fades while the round S mark fades in over the same left edge.
            Constant padding keeps that edge identical in both sidebar states,
            so nothing jumps while the width animates. */}
        <Link
          href="/"
          // h-12 + the sidebar header's p-2 puts the rule below on the same
          // line as the app header's bottom border (h-14 = 56px).
          className="relative flex h-12 items-center overflow-hidden px-0.5"
          aria-label="Shmorkiz home"
        >
          {/* Drawn at exactly the 84×26 it is declared at (the pill is
              1548×481, 83.7 wide at 26 tall): next/image warns on every page
              when the box it measures differs from one attribute only. */}
          <Image
            data-slot="brand-wordmark"
            src={wordmark}
            alt=""
            width={84}
            height={26}
            priority
            className="h-[26px] w-[84px] max-w-none shrink-0 object-contain object-left transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0"
          />
          <Image
            data-slot="brand-mark"
            src={icon}
            alt=""
            width={28}
            height={28}
            className="absolute left-0.5 size-7 opacity-0 transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-100"
          />
        </Link>
        {/* Workiz rules a line under its logo, so the brand reads as a header
            and not as the first row of the menu. Full width in both states:
            a margin that changed with the sidebar would make the line jump
            while the width animates. */}
        <div data-slot="brand-rule" className="-ml-2 -mr-[7px] border-b" />
        {/* Workiz's "Create new" row sits at y=76: 19px under the rule (its
            menu pads 16px, the row's wrapper 4px). */}
        <div className="pt-[19px]">
          {permsLoading ? (
            // The permissions land a beat after the shell paints. Hold the
            // row's room meanwhile, or its arrival pushes the menu down.
            <div data-slot="create-new-held" aria-hidden className="h-10" />
          ) : (
            <CreateNewMenu />
          )}
        </div>
      </SidebarHeader>

      {/* The rows: 12px under the Create new row (8px here + the first row's
          own 4px), 8px in, 32px of air at the foot as in Workiz. A short
          window scrolls it — Workiz clips its menu instead — with the
          scrollbar the platform draws, not hidden. Its items depend on the
          permissions too: out of sight until they are known, so the menu is
          drawn once, where it stays. */}
      <div
        data-slot="sidebar-content"
        data-sidebar="content"
        data-testid="app-nav"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-2 pr-[7px] pb-8 pl-2 group-data-[collapsible=icon]:overflow-hidden",
          permsLoading && "invisible",
        )}
      >
        {isTechnician ? (
          <SidebarMenu>
            {visibleNavItems(TECHNICIAN_NAV, (r) => can(r)).map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        ) : (
          <>
            <SidebarMenu>
              <NavLink item={OVERVIEW_ITEM} pathname={pathname} />
            </SidebarMenu>
            {blocks.map((group) => (
              <div key={group.label} className="contents">
                <NavRule />
                {group.kind === "features" ? (
                  <FeaturesBlock items={group.items} pathname={pathname} />
                ) : (
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <SidebarRail />
    </Sidebar>
  );
}
