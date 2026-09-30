"use client";

import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { useInboxCounters } from "../hooks";

/** Unread-conversation count on the sidebar's Messages item; hidden at zero. */
export function InboxNavBadge() {
  const { data } = useInboxCounters();
  const unread = data?.unreadConversations ?? 0;
  if (unread <= 0) return null;
  return (
    <SidebarMenuBadge
      // SidebarMenuBadge repaints its label with the sidebar's accent ink on
      // peer-hover and when the item is active; both are overridden here so the
      // red pill keeps white digits instead of going dark-on-red under the
      // cursor.
      className="rounded-full bg-destructive text-destructive-foreground peer-hover/menu-button:text-destructive-foreground peer-data-active/menu-button:text-destructive-foreground"
      aria-label={`${unread} unread conversation${unread === 1 ? "" : "s"}`}
    >
      {unread > 99 ? "99+" : unread}
    </SidebarMenuBadge>
  );
}
