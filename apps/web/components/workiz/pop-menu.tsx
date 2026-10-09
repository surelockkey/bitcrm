"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface WzPopMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * Workiz's "Actions ⌄" over the user page (pg_technicians_wz_13_actions_open,
 * `actionButton-module` + the legacy `_popMenu _right`):
 *
 *   button  Button-module secondary regular with its icon: 40px, a 1px ink
 *           edge, the words (13px/19px 600, 0.2px) then a thin chevron;
 *   panel   245px, white, 16px corners, `0 3px 6px rgba(0,0,0,.18),
 *           0 4px 15px rgba(0,0,0,.15)`, 15px under the button with the
 *           right edges level; no caret;
 *   rows    50px, 16px in, 13px/16px ink, no rule between them; the first
 *           and last take the panel's corners.
 *
 * Not the job page's `WzActionsMenu` (34px pill, chevron first, 216px panel
 * with a caret and ruled slate rows).
 */
export function WzPopMenu({
  items,
  label = "Actions",
  className,
}: {
  items: readonly WzPopMenuItem[];
  label?: string;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="wz-pop-menu"
          className={cn(
            "inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-pill border border-foreground bg-transparent px-[25px] text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus data-[state=open]:bg-wz-secondary-hover",
            className,
          )}
        >
          {label}
          <ChevronDown className="size-[19px]" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        alignOffset={3}
        sideOffset={15}
        className="w-[245px] min-w-0 rounded-[16px] p-0 shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t-0"
      >
        {items.map((a) => (
          <DropdownMenuItem
            key={a.key}
            disabled={a.disabled}
            onSelect={a.onSelect}
            className="h-[50px] min-h-0 py-0 pr-4 pl-4 text-[13px] leading-4 tracking-[0.4px] text-foreground first:rounded-t-[16px] last:rounded-b-[16px] focus:text-foreground"
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
