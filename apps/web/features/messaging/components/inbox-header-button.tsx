"use client";

import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermissions } from "@/features/auth/use-permissions";
import { useInboxCounters } from "../hooks";

/** Workiz caps the top-bar badge at two digits. */
export const formatBadgeCount = (n: number): string => (n > 99 ? "99+" : String(n));

/**
 * The Workiz top-bar Messages icon: a chat bubble in the right icon cluster
 * of every page, to the right of the phone, with a red badge carrying the
 * unread-conversation count. Opens the Inbox. Hidden from people who cannot
 * read messages.
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
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground"
          aria-label={label}
          data-testid="inbox-header-button"
        >
          <Link href="/messages">
            <MessageSquareText className="size-4" />
            {unread > 0 ? (
              <span
                data-testid="inbox-header-badge"
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white tabular-nums ring-2 ring-background"
              >
                {formatBadgeCount(unread)}
              </span>
            ) : null}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
