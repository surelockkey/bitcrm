"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTeamChatCounters } from "@/features/messaging/hooks";
import { formatBadgeCount } from "@/features/messaging/components/inbox-header-button";

/**
 * The technician's line to the office: opens their team thread in the
 * Inbox, with the unread count the way Workiz badges its chat bubble.
 * Hidden from anyone who cannot read team chat.
 */
export function TeamChatBadge({ className }: { className?: string }) {
  const { can } = usePermissions();
  const { data } = useTeamChatCounters();
  if (!can("team_chat")) return null;
  const unread = data?.unreadConversations ?? 0;
  const label = unread > 0 ? `Team chat, ${unread} unread` : "Team chat";

  return (
    <Button
      asChild
      variant="outline"
      size="lg"
      className={className ? `relative gap-2 ${className}` : "relative gap-2"}
      aria-label={label}
      data-testid="team-chat-badge"
    >
      <Link href="/messages?kind=team">
        <MessagesSquare className="size-4" />
        <span>Chat</span>
        {unread > 0 ? (
          <span
            data-testid="team-chat-unread"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-chip bg-destructive px-1.5 text-[11px] font-semibold leading-none text-white tabular-nums"
          >
            {formatBadgeCount(unread)}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
