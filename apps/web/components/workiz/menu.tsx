"use client";

import type { ComponentType, ReactNode } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { wzPill } from "./pill";

export interface WzMenuAction {
  key: string;
  label: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  onSelect: () => void;
  disabled?: boolean;
  /** Red words — a delete. Workiz keeps its rows slate; ours flags a destructive one. */
  destructive?: boolean;
}

/**
 * Workiz's "Actions ▾" (job_b_02_actions_open): the outline pill (Workiz's
 * `wfi-down`, an 18px thin chevron, then the word — audit_pixels J3) opening
 * a 216px white panel 10px below — 2px corners,
 * `0 3px 6px 2px rgba(0,0,0,.18), 0 4px 15px 2px rgba(0,0,0,.15)`, a white
 * notch under the middle of the pill (the zoomed capture; audit J5 only noted
 * it was missing): Workiz's 14×7 caret overlaps the panel's edge by 2px,
 * white on white, so what shows is 10px wide and 5px tall — Radix's arrow at
 * that size, its height counted into the 10px gap (Popper adds the arrow's
 * height to `sideOffset`). One row per action: its 20px icon, then 14px
 * #566d76 words, 50px tall, each next one ruled by #cad3d6 and so 51. The
 * panel and rows are `DropdownMenuContent` / `DropdownMenuItem`'s default
 * look; this adds the pill, the caret and the glyphs.
 */
export function WzActionsMenu({
  items,
  label = "Actions",
  align = "end",
  className,
}: {
  items: readonly WzMenuAction[];
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(wzPill("outline"), className)}>
          <ChevronDown className="size-[18px]!" strokeWidth={1.25} />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} alignOffset={-12} sideOffset={5} className="w-[216px] overflow-visible">
        {items.map((a) => {
          const Icon = a.icon;
          return (
            <DropdownMenuItem
              key={a.key}
              variant={a.destructive ? "destructive" : "default"}
              disabled={a.disabled}
              onSelect={a.onSelect}
            >
              {Icon ? <Icon className="size-5" strokeWidth={1.25} /> : null}
              {a.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuPrimitive.Arrow
          data-slot="wz-menu-caret"
          width={10}
          height={5}
          className="fill-popover drop-shadow-[0_-1px_1px_rgba(0,0,0,0.08)]"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
