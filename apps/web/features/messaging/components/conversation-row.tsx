"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { InboxConversation } from "../api";
import { useMessagingAccess, useUpdateConversation } from "../hooks";
import { avatarInitial, formatListTime, KIND_TAG } from "../lib";
import { WzKebabIcon, WzStarIcon } from "./inbox-icons";

/** The row ⋮ menu, as Workiz draws `dropDownOptions`: 135px, r8, its soft shadow, 38px 13px rows, #dcdcdc under the pointer. */
const rowMenu =
  "min-w-[135px] w-auto rounded-[8px] px-0 py-0 shadow-[0_8px_16px_rgba(59,75,82,0.15),0_0_4px_rgba(59,75,82,0.05)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t-0";
const rowMenuItem =
  "h-10 gap-0 rounded-none px-6 py-px text-[13px] leading-[38px] font-normal text-foreground focus:bg-[#dcdcdc] first:rounded-t-[8px] last:rounded-b-[8px]";

/**
 * One line of the Workiz Inbox (`messaging-module__ms_header`,
 * pg_messages_wz_01_list / _02_row_hover / _07_thread_client): 74px, padded
 * 12/12/14/16, no rule between rows; a 35px #3e4b51 disc with the first
 * character in white 21px; the name 14px/16px 500 #404040, cut with "…"
 * before the grey 11px "(Client)" / "(Tech)" / "(Unknown)" tag; the last
 * message 12px under it in #3b4c53; the time 11px #999 top right. Unread is
 * the 14px #f45e44 disc on the avatar's corner — nothing turns bold. Hover
 * #dcdcdc; the open thread #f7f8f8 with a 4px #50d58c edge; the ⋮ (ours:
 * read / star / archive) shows on hover and on the open row.
 */
export function ConversationRow({
  conversation: c,
  title,
  active,
  onSelect,
}: {
  conversation: InboxConversation;
  title: string;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { canManage } = useMessagingAccess();
  const update = useUpdateConversation();
  const unread = c.unread && c.state !== "archived";
  const archived = c.state === "archived";

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"], label: string) =>
    update.mutate({ id: c.id, patch: p, label });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(c.id);
    }
  };
  // The "⋮" menu lives inside the row; its clicks must not open the thread.
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(c.id)}
      onKeyDown={onKeyDown}
      aria-current={active ? "true" : undefined}
      aria-label={title}
      data-conversation-row={c.id}
      data-unread={unread || undefined}
      className={cn(
        "group/row relative flex min-h-12 cursor-pointer items-center pb-[14px] pr-3 pt-3 outline-none focus-visible:bg-[#dcdcdc]",
        // #dcdcdc hover: Workiz's `.ms_header:hover`; the open row keeps its own tint.
        active
          ? "-ml-px border-l-4 border-l-wz-switch-on bg-wz-tile pl-4"
          : "bg-background pl-4 hover:bg-[#dcdcdc]",
      )}
    >
      <span className="relative mr-2.5 shrink-0">
        <Avatar className="size-[35px] after:hidden">
          <AvatarFallback className="bg-wz-tab-bar text-[21px] leading-[35px] font-normal text-white">
            {avatarInitial(title)}
          </AvatarFallback>
        </Avatar>
        {unread ? (
          <span
            aria-label={`${c.unreadCount || 1} unread`}
            className="absolute -right-[3px] -top-[3px] z-[1] size-[14px] rounded-full bg-wz-danger"
          />
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline leading-5">
          <strong className="truncate text-[14px] leading-4 font-medium text-wz-strong">{title}</strong>
          <small className="ml-[2px] shrink-0 text-[11px] leading-[13px] text-wz-caption">({KIND_TAG[c.kind]})</small>
          {c.flagged ? (
            <span role="img" aria-label="Starred" className="ml-1 shrink-0 self-center">
              <WzStarIcon tone="incoming" starred size={11} />
            </span>
          ) : null}
        </span>
        <span className="mt-2 truncate text-[12px] leading-4 text-[#3b4c53]">
          {c.lastMessagePreview || (c.lastMessageAt ? "Attachment" : "No messages yet")}
        </span>
      </span>

      <span className="relative flex shrink-0 flex-col">
        <small className="min-w-[30px] whitespace-nowrap pb-[35px] pl-[3px] text-[11px] leading-[13px] text-wz-caption">
          {formatListTime(c.lastMessageAt)}
        </small>
        {canManage ? (
          <span onClick={stop} onKeyDown={stop} className="absolute -right-1.5 bottom-0.5 z-[2] flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${title}`}
                  className={cn(
                    "grid h-6 w-[22px] place-items-center text-wz-strong opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100",
                    active && "opacity-100",
                  )}
                >
                  <WzKebabIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={rowMenu}>
                <DropdownMenuItem
                  className={rowMenuItem}
                  onSelect={() => patch({ unread: !c.unread }, c.unread ? "Marked read" : "Marked unread")}
                >
                  {c.unread ? "Mark as read" : "Mark as unread"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={rowMenuItem}
                  onSelect={() => patch({ flagged: !c.flagged }, c.flagged ? "Star removed" : "Conversation starred")}
                >
                  {c.flagged ? "Unstar" : "Star"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={rowMenuItem}
                  onSelect={() =>
                    patch(
                      { state: archived ? "open" : "archived" },
                      archived ? "Conversation restored" : "Conversation archived",
                    )
                  }
                >
                  {archived ? "Restore" : "Archive"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </span>
    </div>
  );
}
