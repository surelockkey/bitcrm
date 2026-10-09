"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WzMenuAction } from "./menu";

/**
 * Workiz's "Actions ⌄" on its legacy document pages — the work order view a
 * job's Actions → View Work Order opens (pg_workorders_wz_05_5TU7ZA_actions_open,
 * `a.button._clear.min90` + `#docActions._popActions`):
 *
 *   button  112×34, white, 1px #ccc, 15px corners, 0 15px; the word 13px/600
 *           #666 at 0.5px, then a thin chevron; no hover or open fill
 *           (pg_workorders_wz_04_5TU7ZA_actions_hover / _05: white throughout);
 *   panel   216px, white, 2px corners, 6px 8px, `0 3px 6px rgba(0,0,0,.18),
 *           0 4px 15px rgba(0,0,0,.15)`, centred 10px under the button with a
 *           caret pointing at it;
 *   rows    50px, 15px in, a glyph then 14px/16px #666, 1px #ccc between.
 *
 * Not the job page's `WzActionsMenu` (chevron first, slate rows ruled
 * #cad3d6) nor the user page's `WzPopMenu` (40px ink pill, 245px panel).
 */
export function WzLegacyActionsMenu({
  items,
  label = "Actions",
  className,
}: {
  items: readonly WzMenuAction[];
  label?: string;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="wz-legacy-actions"
          className={cn(
            "inline-flex h-[34px] min-w-[90px] shrink-0 cursor-pointer items-center justify-center gap-[9px] rounded-[15px] border border-input bg-background px-[15px] text-[13px] leading-[19px] font-semibold tracking-[0.5px] text-wz-text outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
            className,
          )}
        >
          {label}
          <ChevronDown className="size-[18px]" strokeWidth={1.25} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={10}
        // Workiz's Send sits right of the button, so its panel always fits; ours
        // may stand alone at the edge — the panel then slides in, the caret stays.
        collisionPadding={20}
        className="w-[216px] overflow-visible shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-input"
      >
        {items.map((a) => {
          const Icon = a.icon;
          return (
            <DropdownMenuItem
              key={a.key}
              variant={a.destructive ? "destructive" : "default"}
              disabled={a.disabled}
              onSelect={a.onSelect}
              className="h-[50px] text-wz-text focus:text-wz-text"
            >
              {Icon ? <Icon className="size-5" strokeWidth={1.25} /> : null}
              {a.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuPrimitive.Arrow
          data-slot="wz-menu-caret"
          width={16}
          height={8}
          className="fill-popover drop-shadow-[0_-1px_1px_rgba(0,0,0,0.08)]"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
