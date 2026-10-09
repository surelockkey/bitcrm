"use client";

import { MessagesSquare } from "lucide-react";
import { WzButtonLink } from "@/components/workiz/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTeamChatCounters } from "@/features/messaging/hooks";
import { formatBadgeCount } from "@/features/messaging/components/inbox-header-button";

/**
 * The technician's line to the office — ours, Workiz's jobs list has none:
 * a Workiz secondary pill (32px, 1px ink edge) beside "Filter results",
 * where the list keeps its one button, opening their team thread in the
 * Inbox. The unread count is Workiz's red counter (#f45e44, white 11px/600),
 * as its top bar badges its chat. Hidden from anyone who cannot read team chat.
 */
export function TeamChatBadge({ className }: { className?: string }) {
  const { can } = usePermissions();
  const { data } = useTeamChatCounters();
  if (!can("team_chat")) return null;
  const unread = data?.unreadConversations ?? 0;
  const label = unread > 0 ? `Team chat, ${unread} unread` : "Team chat";

  return (
    <WzButtonLink
      href="/messages?kind=team"
      variant="secondary"
      size="regular"
      icon={<MessagesSquare strokeWidth={1.75} />}
      aria-label={label}
      data-testid="team-chat-badge"
      className={className}
    >
      Chat
      {unread > 0 ? (
        <span
          data-testid="team-chat-unread"
          className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-wz-danger px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums"
        >
          {formatBadgeCount(unread)}
        </span>
      ) : null}
    </WzButtonLink>
  );
}
