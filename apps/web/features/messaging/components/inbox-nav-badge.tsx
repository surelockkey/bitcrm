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
      className="bg-destructive text-destructive-foreground"
      aria-label={`${unread} unread conversation${unread === 1 ? "" : "s"}`}
    >
      {unread > 99 ? "99+" : unread}
    </SidebarMenuBadge>
  );
}
