"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One glyph in an inventory row's Actions cell, as Workiz draws it: the bare
 * picture (edit.svg, inventory_new.svg, delete-red.svg…) in ink, a little
 * lighter under the cursor (stockModal-module: opacity .7), its one-word
 * tooltip under it (MUI's dark chip: "Edit", "Stock"), and an accessible name
 * that says which row it acts on.
 */
export function RowIconAction({
  label,
  tip,
  onClick,
  disabled = false,
  tone = "ink",
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  disabled?: boolean;
  /** `danger`: Workiz's red delete glyph (#f45e44). */
  tone?: "ink" | "danger";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex flex-none cursor-pointer items-center justify-center rounded-[2px] transition-opacity outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-40",
            tone === "danger" ? "text-wz-danger" : "text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}
