"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversations, usePartyNames } from "../hooks";
import { conversationTitle, flattenConversations } from "../lib";
import { avatarInitial } from "../lib";

/** The list-toolbar icon buttons share one look: a 36px square, 20px glyph. */
export const toolbarButton =
  "relative grid size-9 shrink-0 place-items-center rounded-md text-foreground/80 transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted";

/**
 * The group icon in the list toolbar (Workiz "New group"): lists the team's
 * group chats so one can be opened straight away. Group threads are loaded
 * only once the menu opens.
 */
export function GroupMenu({ onSelect }: { onSelect: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const query = useConversations({ view: "all", kind: "group" }, open);
  const groups = flattenConversations(query.data?.pages);
  const names = usePartyNames(groups);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Groups" className={toolbarButton}>
              <Users className="size-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Team groups</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Team groups</DropdownMenuLabel>
        {query.isLoading ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : groups.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No team groups yet.</div>
        ) : (
          groups.map((g) => {
            const title = conversationTitle(g, names);
            return (
              <DropdownMenuItem key={g.id} onSelect={() => onSelect(g.id)}>
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                  {avatarInitial(title)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{title}</span>
                  {g.lastMessagePreview ? (
                    <span className="block truncate text-[11px] text-muted-foreground">{g.lastMessagePreview}</span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
