"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermissions } from "@/features/auth/use-permissions";
import { useInboxCounters } from "../hooks";

/**
 * The inbox in the top bar on every page, with the unread count — the
 * Workiz badge next to the bell. Hidden from people who cannot read messages.
 */
export function InboxHeaderButton() {
  const { can } = usePermissions();
  const { data } = useInboxCounters();
  if (!can("messages")) return null;
  const unread = data?.unreadConversations ?? 0;
  const label = unread > 0 ? `Messages, ${unread} unread` : "Messages";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-lg" className="relative text-muted-foreground" aria-label={label}>
          <Link href="/messages">
            <MessagesSquare className="size-4" />
            {unread > 0 ? (
              <span
                data-testid="inbox-header-badge"
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
