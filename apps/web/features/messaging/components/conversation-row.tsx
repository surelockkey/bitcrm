"use client";

import { Briefcase, ImageIcon, Mail, MessageSquare, Star, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { InboxConversation } from "../api";
import { formatListTime, initialsOf, KIND_LABEL } from "../lib";

/**
 * One line of the inbox, as in Workiz: avatar, name or number, the last
 * message's snippet, a relative time, an unread dot with the count, the
 * star, the channel, and a job mark when the last line was about one.
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
  const unread = c.unread && c.state !== "archived";
  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      aria-current={active ? "true" : undefined}
      data-unread={unread || undefined}
      className={cn(
        "relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
        active && "bg-accent",
      )}
    >
      {unread ? (
        <span aria-hidden className="absolute left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand" />
      ) : null}
      <Avatar className="mt-0.5">
        <AvatarFallback className={cn("text-xs font-semibold", c.kind === "team" && "bg-brand/10 text-brand")}>
          {c.kind === "team" || c.kind === "group" ? <UserRound className="size-4" /> : initialsOf(title)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          <span className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-medium text-brand" : "text-muted-foreground")}>
            {formatListTime(c.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {c.lastChannel === "email" ? (
            <Mail className="size-3 shrink-0 text-muted-foreground" aria-label="Email" />
          ) : c.lastChannel === "in_app" ? (
            <MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-label="In-app" />
          ) : c.lastChannel === "mms" ? (
            <ImageIcon className="size-3 shrink-0 text-muted-foreground" aria-label="MMS" />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {c.lastDirection === "outbound" ? "You: " : ""}
            {c.lastMessagePreview || (c.lastMessageAt ? "Attachment" : "No messages yet")}
          </span>
          {c.flagged ? <Star className="size-3 shrink-0 fill-current text-amber-500" aria-label="Starred" /> : null}
          {c.lastDealId ? <Briefcase className="size-3 shrink-0 text-muted-foreground" aria-label="Linked to a job" /> : null}
          {unread ? (
            <span
              aria-label={`${c.unreadCount || 1} unread`}
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums"
            >
              {c.unreadCount > 99 ? "99+" : c.unreadCount || ""}
            </span>
          ) : null}
        </span>
        {c.kind !== "client" ? (
          <span className="mt-1 inline-block rounded-sm bg-muted px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {KIND_LABEL[c.kind]}
          </span>
        ) : null}
      </span>
    </button>
  );
}
