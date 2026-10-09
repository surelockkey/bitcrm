"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermissions } from "@/features/auth/use-permissions";
import { useInboxCounters } from "../hooks";
import { WzNewMessageIcon } from "./inbox-icons";

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
          className="relative h-9 w-9 text-foreground"
          aria-label={label}
          data-testid="inbox-header-button"
        >
          <Link href="/messages">
            <WzNewMessageIcon className="size-6" />
            {/* Workiz's `messages_indicator` (pg_messages_wz_01_list): a 22px
                #f45e44 disc, 2px #f3f6f7 ring, 10px/18px 500 white, hung 6px
                above the icon's top-right. */}
            {unread > 0 ? (
              <span
                data-testid="inbox-header-badge"
                className="absolute -top-1.5 left-5 grid size-[22px] place-items-center rounded-full border-2 border-topbar bg-wz-danger text-[10px] leading-[18px] font-medium tracking-normal text-white tabular-nums"
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
