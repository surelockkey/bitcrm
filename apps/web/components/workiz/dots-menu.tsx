"use client";

import { Fragment, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface WzDotsMenuItem {
  key: string;
  label: ReactNode;
  /** A 20px glyph before the words (lucide, `currentColor`). */
  icon?: ReactNode;
  onSelect: () => void;
  /** Workiz's `redText` row: Delete in #f45e44, glyph included. */
  destructive?: boolean;
  disabled?: boolean;
  /** The row's accessible name, when the words alone are not enough ("Delete Canceled job & techs"). */
  "aria-label"?: string;
  /**
   * A line said under the row — why it is disabled, in the menu itself,
   * because a disabled row takes no focus and a tooltip on it would never
   * reach a keyboard.
   */
  note?: ReactNode;
}

/**
 * Workiz's `dotsPopMenu` on a card (the Automation Center's rule cards,
 * pg_automations_wz_12_dots_open):
 *
 *   trigger  a 40×20 box of three 4px #3b4b52 dots 4px apart, #6aa8ee under
 *            the cursor (and while open);
 *   panel    the legacy `_popMenu`: 175px, white, 16px corners,
 *            `0 3px 6px rgba(0,0,0,.18), 0 4px 15px rgba(0,0,0,.15)`, 10px
 *            top and bottom, hung 15px under the dots with the right edges
 *            level;
 *   rows     37px, 16px/22px ink, a 20px glyph 10px in and the words 10px
 *            after it; no rules between rows; `destructive` in #f45e44.
 *
 * Not `WzPopMenu` (the user page's "Actions ⌄" pill with 50px rows) nor
 * `WzActionsMenu` (the job page's).
 */
export function WzDotsMenu({
  items,
  "aria-label": ariaLabel,
  disabled,
  tone = "ink",
  className,
}: {
  items: readonly WzDotsMenuItem[];
  "aria-label": string;
  disabled?: boolean;
  /** `"light"`: #9ea6aa dots turning white, for a dark surface (the automation builder's slate canvas). */
  tone?: "ink" | "light";
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          data-slot="wz-dots-menu"
          className={cn(
            "group/dots flex h-5 w-10 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                "size-1 rounded-full",
                tone === "light"
                  ? "bg-wz-outline group-hover/dots:bg-white group-data-[state=open]/dots:bg-white"
                  : "bg-foreground group-hover/dots:bg-wz-link group-data-[state=open]/dots:bg-wz-link",
              )}
            />
          ))}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={15}
        className="w-[175px] min-w-0 rounded-[16px] px-0 py-2.5 shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t-0"
      >
        {items.map((item) => (
          <Fragment key={item.key}>
            <DropdownMenuItem
              variant={item.destructive ? "destructive" : "default"}
              disabled={item.disabled}
              aria-label={item["aria-label"]}
              onSelect={item.onSelect}
              className={cn(
                "h-[37px] min-h-0 gap-2.5 py-0 pr-2.5 pl-2.5 text-base leading-[22px] tracking-[0.4px] text-foreground focus:text-foreground",
                "[&_svg:not([class*='size-'])]:size-5",
                item.destructive && "text-wz-danger focus:text-wz-danger",
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
            {item.note ? (
              <DropdownMenuLabel className="px-2.5 py-1 text-xs leading-4 font-normal whitespace-normal text-wz-outline-label">
                {item.note}
              </DropdownMenuLabel>
            ) : null}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
