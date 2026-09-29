"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { Archive, ArchiveRestore, EllipsisVertical, MailOpen, Star } from "lucide-react";
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

/**
 * One line of the Workiz Inbox: a round dark avatar with the first letter,
 * the name in bold with the grey "(Client)" / "(Tech)" / "(Unknown)" tag,
 * the time at the right, one line of the last message underneath, and a
 * "⋮" menu that appears on hover. The open thread carries a green bar on
 * its left edge; an unread one a red dot by the time.
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
        "group/row relative flex cursor-pointer items-start gap-3 border-l-4 py-3 pl-3 pr-3 outline-none transition-colors focus-visible:bg-muted/40",
        active ? "border-l-emerald-500 bg-muted/60" : "border-l-transparent hover:bg-muted/40",
      )}
    >
      <Avatar className="mt-0.5 size-9">
        <AvatarFallback className="bg-muted text-[15px] font-medium text-muted-foreground">
          {avatarInitial(title)}
        </AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">
          <strong className={cn("text-[15px] text-foreground", unread ? "font-bold" : "font-semibold")}>{title}</strong>
          <small className="ml-1 text-xs text-muted-foreground">({KIND_TAG[c.kind]})</small>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              unread ? "font-medium text-foreground" : "text-foreground/75",
            )}
          >
            {c.lastMessagePreview || (c.lastMessageAt ? "Attachment" : "No messages yet")}
          </span>
          {c.flagged ? <Star className="size-3 shrink-0 fill-current text-amber-500" aria-label="Starred" /> : null}
        </span>
      </span>

      <span className="flex w-14 shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1 pt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {unread ? (
            <span aria-label={`${c.unreadCount || 1} unread`} className="size-1.5 rounded-full bg-destructive" />
          ) : null}
          {formatListTime(c.lastMessageAt)}
        </span>
        {canManage ? (
          <span onClick={stop} onKeyDown={stop} className="-mr-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${title}`}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
                >
                  <EllipsisVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onSelect={() => patch({ unread: !c.unread }, c.unread ? "Marked read" : "Marked unread")}
                >
                  <MailOpen className="size-4" /> {c.unread ? "Mark as read" : "Mark as unread"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => patch({ flagged: !c.flagged }, c.flagged ? "Star removed" : "Conversation starred")}
                >
                  <Star className={cn("size-4", c.flagged && "fill-current text-amber-500")} />{" "}
                  {c.flagged ? "Unstar" : "Star"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    patch(
                      { state: archived ? "open" : "archived" },
                      archived ? "Conversation restored" : "Conversation archived",
                    )
                  }
                >
                  {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
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
