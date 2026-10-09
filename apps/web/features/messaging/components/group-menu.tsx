"use client";

import { useState } from "react";
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
import { WzGroupChatIcon } from "./inbox-icons";

/** The list bar's icon buttons — Workiz's IconButton large/white: 40×40, r8, a 24px ink glyph, #f3f6f7 under the pointer. */
export const toolbarButton =
  "relative grid size-10 shrink-0 place-items-center rounded-[8px] text-foreground transition-colors hover:bg-wz-secondary-hover data-[state=open]:bg-wz-secondary-hover";

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
              <WzGroupChatIcon />
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
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-wz-tab-bar text-[13px] text-white">
                  {avatarInitial(title)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] leading-4 font-medium text-wz-strong">{title}</span>
                  {g.lastMessagePreview ? (
                    <span className="mt-1 block truncate text-[12px] leading-4 text-[#3b4c53]">{g.lastMessagePreview}</span>
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
